#!/usr/bin/env node
/**
 * Emit `SHA256SUMS.txt` next to the packaged installer, run after
 * `electron-builder --win nsis` (see `npm run package:win`).
 *
 * Why this exists: the in-app updater downloads the installer, then verifies
 * it against a `SHA256SUMS.txt` asset fetched from the *same* GitHub release
 * (see `verifyReleaseAsset` in src/main/ipc/update-handlers.ts). If that asset
 * was never uploaded, the verification request 404s and the update fails with
 * "VesPi UI installer download or verification failed: Error: 404" even though
 * the installer itself is present and valid.
 *
 * The file format must match `parseSha256Sum`, which accepts both
 * `<hash>  <name>` and `<hash> *<name>` (sha256sum's binary-mode marker).
 *
 * Usage: node scripts/write-release-checksums.mjs [releaseDir]
 *        (defaults to the newest `release*` directory in the project root)
 */
import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHECKSUM_FILE = 'SHA256SUMS.txt'

function sha256OfFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/** Newest `release*` directory that actually contains an installer. */
function findReleaseDir() {
  const candidates = readdirSync(projectDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^release/.test(entry.name))
    .map((entry) => join(projectDir, entry.name))
    .filter((dir) => readdirSync(dir).some((name) => name.endsWith('.exe')))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return candidates[0] ?? null
}

const releaseDir = process.argv[2] ? join(projectDir, process.argv[2]) : findReleaseDir()
if (!releaseDir) {
  console.error(`[checksums] No release directory containing an installer was found under ${projectDir}`)
  process.exit(1)
}

const installers = readdirSync(releaseDir).filter((name) => name.endsWith('.exe'))
if (installers.length === 0) {
  console.error(`[checksums] No .exe installer found in ${releaseDir}`)
  process.exit(1)
}

const lines = []
for (const name of installers.sort()) {
  const hash = await sha256OfFile(join(releaseDir, name))
  // Two spaces + the filename matches `sha256sum` text-mode output, which
  // `parseSha256Sum` reads directly.
  lines.push(`${hash}  ${name}`)
  console.log(`[checksums] ${hash}  ${name}`)
}

const outPath = join(releaseDir, CHECKSUM_FILE)
writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8')
console.log(`[checksums] Wrote ${outPath}`)
console.log(`[checksums] Upload this file to the GitHub release alongside the installer:`)
console.log(`            gh release upload <tag> "${outPath}" --repo esseener/VesPi --clobber`)
