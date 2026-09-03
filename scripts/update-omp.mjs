/**
 * Refresh the bundled OMP kernel before a Windows package build.
 *
 * Downloads the newest published `omp-windows-x64.exe` (or arm64) from
 * can1357/oh-my-pi into the repo's runtime/omp/, replacing the binary only
 * when the release tag differs from the marker file. Network failures warn
 * and exit 0 so packaging can proceed with the existing kernel.
 */
import { existsSync, readFileSync, renameSync, writeFileSync, unlinkSync, statSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const REPO = 'can1357/oh-my-pi'
const MARKER = '.version'
const TIMEOUT_MS = 10 * 60_000
const USER_AGENT = 'VesPi-packaging'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const runtimeDir = join(scriptDir, '..', '..', 'runtime', 'omp')
const ompPath = join(runtimeDir, 'omp.exe')
const markerPath = join(runtimeDir, MARKER)

const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
const assetName = `omp-windows-x64.exe`.replace('x64', arch)

function log(message) {
  console.log(`[update-omp] ${message}`)
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
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
    if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
    let received = 0
    const source = Readable.fromWeb(res.body)
    source.on('data', (chunk) => {
      received += chunk.length
      process.stdout.write(`\r[update-omp] ${Math.round(received / 1024 / 1024)} MB`)
    })
    await pipeline(source, createWriteStream(dest))
    process.stdout.write('\n')
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  if (process.platform !== 'win32') {
    log('not win32; skipping kernel refresh')
    return
  }

  let latest = null
  try {
    const releases = await fetchJson(`https://api.github.com/repos/${REPO}/releases?per_page=10`, 15_000)
    const published = releases.filter((r) => !r.draft)
    latest = published[0] ?? null
  } catch (err) {
    log(`could not reach GitHub (${err.message}); keeping the existing kernel`)
    return
  }
  if (!latest) {
    log('no published release found; keeping the existing kernel')
    return
  }

  const tag = latest.tag_name.replace(/^v/, '')
  const asset = (latest.assets ?? []).find((a) => a.name === assetName)
  if (!asset) {
    log(`release ${tag} has no ${assetName}; keeping the existing kernel`)
    return
  }

  const currentTag = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : ''
  if (currentTag === tag && existsSync(ompPath)) {
    log(`kernel already at ${tag}; nothing to do`)
    return
  }

  const staged = `${ompPath}.new`
  log(`downloading OMP ${tag} (${assetName})…`)
  try {
    await downloadTo(asset.browser_download_url, staged)
    if (existsSync(ompPath)) {
      const backup = `${ompPath}.bak`
      try { unlinkSync(backup) } catch { /* no previous backup */ }
      renameSync(ompPath, backup)
    }
    renameSync(staged, ompPath)
    writeFileSync(markerPath, tag)
    const mb = Math.round(statSync(ompPath).size / 1024 / 1024)
    log(`bundled OMP updated to ${tag} (${mb} MB)`)
  } catch (err) {
    log(`download failed (${err.message}); keeping the existing kernel`)
    try { unlinkSync(staged) } catch { /* ignore */ }
  }
}

main().catch((err) => {
  log(`unexpected error (${err.message}); keeping the existing kernel`)
})
