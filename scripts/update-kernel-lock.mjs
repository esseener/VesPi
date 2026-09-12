#!/usr/bin/env node
/**
 * Bump `resources/omp-runtime-lock.json` to the newest `can1357/oh-my-pi` release.
 *
 * Why this exists: `update-omp.mjs` is *lock-driven*. It guarantees the bundled
 * binary matches the lock, and never looks up what the newest release is — so
 * there was no supported way to answer "is the kernel current?", let alone
 * advance it. Advancing meant hand-editing the version and hand-computing a
 * SHA-256, which is exactly the kind of step that rots.
 *
 *   node scripts/update-kernel-lock.mjs           # report and bump
 *   node scripts/update-kernel-lock.mjs --check   # report only, change nothing
 *
 * The lock stays explicit and reviewable: this writes the version and the digest
 * the release itself publishes, and the change shows up in the diff for review.
 * Fetching the binary is still `update-omp.mjs`'s job.
 *
 * Exit codes: 0 = lock current (or bumped), 1 = behind and told not to write,
 * 2 = could not determine the newest release.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const lockPath = join(projectDir, 'resources', 'omp-runtime-lock.json')
const checkOnly = process.argv.includes('--check')
const platformKey = `${process.platform}-${process.arch}`

const log = (message) => console.log(`[kernel-lock] ${message}`)

function fail(message) {
  console.error(`[kernel-lock] ${message}`)
  process.exit(2)
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'VesPi-packaging' },
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${url}`)
  return response.json()
}

async function getText(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'VesPi-packaging' },
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`download ${response.status} for ${url}`)
  return response.text()
}

/** Accepts both `<hash>  <name>` and `<hash> *<name>` (sha256sum binary mode). */
function parseSha256Sum(text, assetName) {
  for (const line of text.split('\n')) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/)
    if (match && match[2].trim() === assetName) return match[1]
  }
  return null
}

let lock
try {
  lock = JSON.parse(readFileSync(lockPath, 'utf-8'))
} catch (error) {
  fail(`cannot read ${lockPath}: ${error.message}`)
}

const asset = lock?.assets?.[platformKey]
if (!lock?.version || !lock?.repository || !asset?.name) {
  fail(`${lockPath} is missing version, repository, or assets["${platformKey}"].name`)
}

let release
try {
  release = await getJson(`https://api.github.com/repos/${lock.repository}/releases/latest`)
} catch (error) {
  fail(`could not determine the newest release: ${error.message} — treat as unknown, not as current`)
}

const tag = String(release.tag_name ?? '')
const nextVersion = tag.replace(/^v/i, '')
if (!/^\d+\.\d+\.\d+/.test(nextVersion)) fail(`release tag "${tag}" is not a version`)

if (nextVersion === lock.version) {
  log(`lock is current at ${lock.version}`)
  process.exit(0)
}

log(`newest release is ${tag} (released ${release.published_at ?? 'unknown'}); lock is ${lock.version}`)

if (checkOnly) {
  console.error(`[kernel-lock] lock is behind ${tag}; re-run without --check to advance it`)
  process.exit(1)
}

// Take the digest from the release's own SHA256SUMS.txt rather than downloading
// the 150 MB binary to hash it: the release publishes the digest, and
// update-omp.mjs verifies the download against whatever we write here anyway.
const checksumAsset = lock.checksumAsset ?? 'SHA256SUMS.txt'
const sums = (release.assets ?? []).find((entry) => entry.name === checksumAsset)
if (!sums?.browser_download_url) {
  fail(`release ${tag} has no ${checksumAsset} asset; cannot pin a digest`)
}

let digest = null
try {
  digest = parseSha256Sum(await getText(sums.browser_download_url), asset.name)
} catch (error) {
  fail(`could not read ${checksumAsset}: ${error.message}`)
}
if (!digest) fail(`${checksumAsset} in ${tag} has no entry for ${asset.name}`)

const next = {
  ...lock,
  version: nextVersion,
  assets: { ...lock.assets, [platformKey]: { ...asset, sha256: digest } },
}
writeFileSync(lockPath, `${JSON.stringify(next, null, 2)}\n`, 'utf-8')

log(`lock advanced ${lock.version} → ${nextVersion} (${asset.name} sha256 ${digest.slice(0, 12)}…)`)
log('next: npm run prepare:runtime:release  # download and verify the binary')
log('then: npm run check:release')
