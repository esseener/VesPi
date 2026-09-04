#!/usr/bin/env node
/**
 * Prepare the bundled OMP runtime from an explicit, reviewable lock file.
 *
 * Default mode is developer-friendly: failures retain the existing binary.
 * `--strict` is for release builds: every mismatch or network/probe failure
 * exits non-zero, so an installer can never silently ship an unknown runtime.
 */
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectDir = join(scriptDir, '..')
const runtimeDir = join(projectDir, '..', 'runtime', 'omp')
const lockPath = join(projectDir, 'resources', 'omp-runtime-lock.json')
const ompPath = join(runtimeDir, 'omp.exe')
const markerPath = join(runtimeDir, '.version')
const strict = process.argv.includes('--strict')
const TIMEOUT_MS = 10 * 60_000
const USER_AGENT = 'VesPi-packaging'

function log(message) {
  console.log(`[prepare-omp] ${message}`)
}

function fail(message, cause) {
  const detail = cause instanceof Error ? `: ${cause.message}` : ''
  if (strict) throw new Error(`${message}${detail}`)
  log(`${message}${detail}; keeping the existing kernel`)
  return false
}

function readLock() {
  const parsed = JSON.parse(readFileSync(lockPath, 'utf8'))
  if (!parsed || typeof parsed !== 'object') throw new Error('runtime lock must be an object')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(parsed.version ?? '')) {
    throw new Error('runtime lock has an invalid version')
  }
  if (!/^[^/]+\/[^/]+$/.test(parsed.repository ?? '')) throw new Error('runtime lock has an invalid repository')
  const key = `${process.platform}-${process.arch}`
  const asset = parsed.assets?.[key]
  if (!asset) throw new Error(`runtime lock has no asset for ${key}`)
  if (typeof asset.name !== 'string' || !/^[0-9a-f]{64}$/.test(asset.sha256 ?? '')) {
    throw new Error(`runtime lock asset ${key} is invalid`)
  }
  return { repository: parsed.repository, version: parsed.version, checksumAsset: parsed.checksumAsset, asset }
}

function sha256Of(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(path)
    input.on('error', reject)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', () => resolve(hash.digest('hex')))
  })
}

async function downloadTo(url, dest) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/octet-stream' },
      signal: controller.signal,
      redirect: 'follow',
    })
    if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${res.statusText}`)
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
  } finally {
    clearTimeout(timer)
  }
}

function probeVersion(binary, expected) {
  const result = spawnSync(binary, ['--version'], {
    cwd: runtimeDir,
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  })
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr || 'runtime probe failed')
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const match = text.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)
  if (!match) throw new Error('runtime did not report a parseable version')
  if (match[1] !== expected) throw new Error(`runtime reports ${match[1]}, lock requires ${expected}`)
}

async function verifyExisting(lock) {
  if (!existsSync(ompPath)) return false
  const actual = await sha256Of(ompPath)
  if (actual !== lock.asset.sha256) return false
  probeVersion(ompPath, lock.version)
  const marker = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : ''
  if (marker !== lock.version) writeFileSync(markerPath, `${lock.version}\n`)
  return true
}

async function main() {
  if (process.platform !== 'win32') {
    if (strict) throw new Error('strict VesPi packaging currently supports Windows only')
    log('not win32; runtime preparation skipped')
    return
  }

  let lock
  try {
    lock = readLock()
  } catch (error) {
    fail('could not read the runtime lock', error)
    return
  }

  try {
    if (await verifyExisting(lock)) {
      log(`locked OMP ${lock.version} already verified`)
      return
    }
  } catch (error) {
    if (!strict) log(`existing runtime failed verification: ${error.message}`)
  }

  const tag = lock.version.startsWith('v') ? lock.version : `v${lock.version}`
  const url = `https://github.com/${lock.repository}/releases/download/${tag}/${lock.asset.name}`
  const staged = `${ompPath}.new`
  const backup = `${ompPath}.bak`
  let backedUp = false
  try {
    log(`downloading locked OMP ${lock.version} (${lock.asset.name})`)
    await downloadTo(url, staged)
    const actual = await sha256Of(staged)
    if (actual !== lock.asset.sha256) {
      throw new Error(`checksum mismatch: expected ${lock.asset.sha256}, got ${actual}`)
    }
    probeVersion(staged, lock.version)

    if (existsSync(backup)) unlinkSync(backup)
    if (existsSync(ompPath)) {
      try {
        renameSync(ompPath, backup)
      } catch {
        copyFileSync(ompPath, backup)
        unlinkSync(ompPath)
      }
      backedUp = true
    }
    try {
      renameSync(staged, ompPath)
    } catch {
      copyFileSync(staged, ompPath)
      unlinkSync(staged)
    }
    if (process.platform !== 'win32') chmodSync(ompPath, 0o755)
    writeFileSync(markerPath, `${lock.version}\n`)
    log(`locked OMP ${lock.version} ready (${Math.round(statSync(ompPath).size / 1024 / 1024)} MB)`)
  } catch (error) {
    try { if (existsSync(staged)) unlinkSync(staged) } catch { /* ignore cleanup */ }
    if (backedUp) {
      try { if (existsSync(ompPath)) unlinkSync(ompPath) } catch { /* ignore cleanup */ }
      try { renameSync(backup, ompPath) } catch { /* preserve the original failure */ }
    }
    fail('runtime preparation failed', error)
  }
}

main().catch((error) => {
  console.error(`[prepare-omp] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
