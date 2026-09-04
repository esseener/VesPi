#!/usr/bin/env node
/**
 * Release-consistency gate, run by `npm run check`.
 *
 * Guards the invariant that what ships is what was reviewed:
 *   1. package.json carries a valid semver version.
 *   2. resources/omp-runtime-lock.json exists, parses, and its version matches
 *      the runtime/omp/.version marker written next to the binary.
 *   3. The actual runtime/omp/omp.exe bytes match the SHA-256 pinned in the
 *      lock for this platform. A stale or hand-swapped binary fails here even
 *      if nobody ran `update-omp.mjs --strict` beforehand.
 *
 * Exits non-zero with a readable reason on any mismatch.
 */
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const lockPath = join(projectDir, 'resources', 'omp-runtime-lock.json')
const runtimeDir = join(projectDir, '..', 'runtime', 'omp')
const binaryPath = join(runtimeDir, 'omp.exe')
const markerPath = join(runtimeDir, '.version')

function fail(message) {
  console.error(`[check-release] ${message}`)
  process.exit(1)
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'))
if (!SEMVER.test(pkg.version)) fail(`package.json version "${pkg.version}" is not valid semver`)

if (!existsSync(lockPath)) fail(`${lockPath} is missing; the bundled runtime must be pinned by a lock file`)
const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
if (!SEMVER.test(lock.version ?? '')) fail(`omp-runtime-lock.json version "${lock.version}" is not valid semver`)

if (!existsSync(markerPath)) fail(`${markerPath} is missing; the bundled runtime has no version marker`)
const marker = readFileSync(markerPath, 'utf8').trim()
if (marker !== lock.version) {
  fail(`runtime/omp/.version is "${marker}" but the lock pins "${lock.version}"; run npm run prepare:runtime:release`)
}

const platformKey = `${process.platform}-${process.arch}`
const asset = lock.assets?.[platformKey]
if (!asset) fail(`omp-runtime-lock.json has no asset entry for ${platformKey}`)
if (!existsSync(binaryPath)) fail(`${binaryPath} is missing for ${platformKey}`)

const hash = await new Promise((resolve, reject) => {
  const h = createHash('sha256')
  createReadStream(binaryPath).on('error', reject).on('data', (chunk) => h.update(chunk)).on('end', () => resolve(h.digest('hex')))
})
if (hash !== asset.sha256) {
  fail(
    `runtime/omp/omp.exe sha256 is ${hash.slice(0, 12)}… but the lock pins ${asset.sha256.slice(0, 12)}…; ` +
      'the bundled binary does not match the reviewed release',
  )
}

console.log(`[check-release] OK — app ${pkg.version}, runtime ${lock.version} (${platformKey}) matches its lock`)
