#!/usr/bin/env node
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Vendored projects own their test runners and dependencies. Keep the same
// application test set on Windows, CI and coverage runs.
function testsIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['vendor', 'node_modules', '.git'].includes(entry.name)) return []
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return testsIn(path)
    return /\.test\.(?:ts|mjs)$/.test(entry.name) ? [path] : []
  })
}

const result = spawnSync(process.execPath, [
  '--import', 'tsx', '--test', '--test-concurrency=1',
  ...process.argv.slice(2),
  ...['src', 'resources', 'scripts'].flatMap(testsIn).sort(),
], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
