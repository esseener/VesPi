#!/usr/bin/env node
/**
 * Report whether the bundled OMP kernel is the newest upstream release.
 *
 * Run before any push that ships a package: the kernel is half the product, and
 * a release built on a stale kernel hands users an older runtime than the one
 * their own app would fetch anyway.
 *
 *   node scripts/check-kernel-latest.mjs
 *
 * Exit codes:
 *   0 — bundled version matches the newest `can1357/oh-my-pi` release
 *   1 — bundled version is behind; refresh before packaging (see AGENTS.md)
 *   2 — the newest release could not be determined (network, API, bad lock)
 *
 * Exit code 2 is deliberately distinct from 0: an unreachable API must never be
 * mistaken for "up to date". In CI or an offline sandbox, decide explicitly.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const lockPath = join(projectDir, 'resources', 'omp-runtime-lock.json')

/** Compare dotted numeric versions; returns negative / 0 / positive. */
function compareVersions(a, b) {
  const parse = (value) => String(value).trim().replace(/^v/i, '').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function readLock() {
  const parsed = JSON.parse(readFileSync(lockPath, 'utf-8'))
  if (!parsed?.version || !parsed?.repository) {
    throw new Error(`${lockPath} is missing "version" or "repository"`)
  }
  return { version: String(parsed.version), repository: String(parsed.repository) }
}

async function fetchLatestTag(repository) {
  const url = `https://api.github.com/repos/${repository}/releases/latest`
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'vespi-kernel-check' },
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${url}`)
  const body = await response.json()
  const tag = body?.tag_name
  if (!tag) throw new Error(`no tag_name in the response for ${repository}`)
  return { tag: String(tag), publishedAt: body?.published_at ?? null }
}

let lock
try {
  lock = readLock()
} catch (error) {
  console.error(`[kernel-check] cannot read the pinned kernel: ${error.message}`)
  process.exit(2)
}

let latest
try {
  latest = await fetchLatestTag(lock.repository)
} catch (error) {
  console.error(`[kernel-check] could not determine the newest kernel: ${error.message}`)
  console.error(`[kernel-check] bundled is ${lock.version}; treat this as unknown, not as up to date.`)
  process.exit(2)
}

const comparison = compareVersions(lock.version, latest.tag)

if (comparison === 0) {
  console.log(`[kernel-check] OK — bundled kernel ${lock.version} is the newest release of ${lock.repository}`)
  process.exit(0)
}

if (comparison > 0) {
  console.log(
    `[kernel-check] bundled kernel ${lock.version} is AHEAD of the newest release (${latest.tag}) — fine if that is deliberate`
  )
  process.exit(0)
}

console.error(`[kernel-check] bundled kernel ${lock.version} is BEHIND ${latest.tag} (released ${latest.publishedAt})`)
console.error('[kernel-check] refresh it, rebuild, then push:')
console.error('[kernel-check]   npm run package:win      # refreshes the kernel, builds, packages, writes SHA256SUMS.txt')
console.error('[kernel-check]   # or, for a shell-only change you want to keep: ')
console.error('[kernel-check]   npm run prepare:runtime:release && npm run check:release')
process.exit(1)
