/**
 * Refresh the bundled OMP kernel before a Windows package build.
 *
 * Downloads the newest published `omp-windows-x64.exe` (or arm64) from
 * can1357/oh-my-pi into the repo's runtime/omp/, verifying it against the
 * release's SHA256SUMS.txt before it replaces the existing binary. Only swaps
 * when the release tag differs from the marker file. Network or verification
 * failures warn and exit 0 so packaging can proceed with the existing kernel.
 */
import { existsSync, readFileSync, renameSync, writeFileSync, unlinkSync, statSync } from 'node:fs'
import { createWriteStream, createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
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

async function fetchText(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain' },
      signal: controller.signal,
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
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

function expectedHash(sumsText, name) {
  for (const line of sumsText.split(/\r?\n/)) {
    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/)
    if (!match) continue
    const file = match[2].trim()
    if (file === name || file.split('/').pop() === name) return match[1].toLowerCase()
  }
  return null
}

function versionNums(tag) {
  const [core] = tag.replace(/^v/, '').split('-')
  return core.split('.').map((n) => parseInt(n, 10) || 0)
}

function isHigher(a, b) {
  const va = versionNums(a)
  const vb = versionNums(b)
  for (let i = 0; i < 3; i++) {
    if ((va[i] ?? 0) !== (vb[i] ?? 0)) return (va[i] ?? 0) > (vb[i] ?? 0)
  }
  return false
}

async function main() {
  if (process.platform !== 'win32') {
    log('not win32; skipping kernel refresh')
    return
  }

  let latest
  try {
    const releases = await fetchJson(`https://api.github.com/repos/${REPO}/releases?per_page=10`, 15_000)
    const published = releases.filter((r) => !r.draft)
    // Same "latest" semantics as the in-app updater: highest version, not API order.
    const candidates = published.filter((r) => !r.prerelease)
    latest = (candidates.length ? candidates : published).reduce(
      (best, r) => (best === null || isHigher(r.tag_name, best.tag_name) ? r : best),
      null,
    )
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
    // Integrity anchor: the release's own SHA256SUMS (same GitHub HTTPS origin).
    const sumsText = await fetchText(
      `${asset.browser_download_url.slice(0, asset.browser_download_url.lastIndexOf('/') + 1)}SHA256SUMS.txt`,
      15_000,
    )
    const want = expectedHash(sumsText, assetName)
    if (!want) throw new Error(`SHA256SUMS.txt has no checksum for ${assetName}`)
    await downloadTo(asset.browser_download_url, staged)
    const got = await sha256Of(staged)
    if (got !== want) throw new Error(`checksum mismatch (expected ${want.slice(0, 12)}…, got ${got.slice(0, 12)}…)`)
    let backedUp = false
    try {
      if (existsSync(ompPath)) {
        const backup = `${ompPath}.bak`
        try { unlinkSync(backup) } catch { /* no previous backup */ }
        renameSync(ompPath, backup)
        backedUp = true
      }
      renameSync(staged, ompPath)
    } catch (err) {
      // Replacement died mid-way: put the previous binary back.
      if (backedUp) {
        try { if (existsSync(ompPath)) unlinkSync(ompPath) } catch { /* ignore */ }
        try { renameSync(`${ompPath}.bak`, ompPath) } catch { /* keep erroring below */ }
      }
      throw err
    }
    writeFileSync(markerPath, tag)
    // Ship the kernel's own MIT license next to the binary (redistribution
    // requirement). Best-effort: a missing asset never blocks packaging.
    try {
      const license = (latest.assets ?? []).find((a) => a.name === 'LICENSE')
      if (license) {
        writeFileSync(join(runtimeDir, 'LICENSE'), await fetchText(license.browser_download_url, 15_000))
        log('bundled OMP LICENSE updated')
      }
    } catch (err) {
      log(`could not refresh OMP LICENSE (${err.message}); keeping the existing one`)
    }
    const mb = Math.round(statSync(ompPath).size / 1024 / 1024)
    log(`bundled OMP updated to ${tag} (${mb} MB, checksum verified)`)
  } catch (err) {
    log(`kernel refresh failed (${err.message}); keeping the existing kernel`)
    try { unlinkSync(staged) } catch { /* ignore */ }
  }
}

main().catch((err) => {
  log(`unexpected error (${err.message}); keeping the existing kernel`)
})
