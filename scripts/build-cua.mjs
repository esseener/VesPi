#!/usr/bin/env node
/**
 * Builds the desktop-control helper and stages it where the packaging step finds it.
 *
 * The helper is a Rust executable (`native-cua/`), not a Node addon, so that one
 * binary works across Electron versions instead of being tied to a Node ABI. It
 * is a build product and is deliberately not in git.
 *
 * `resources/` is copied verbatim into the installer via `extraResources`, so
 * staging it there is the whole integration: no packaging config to keep in sync.
 * In development, `app.getAppPath()` resolves to this directory, so the same path
 * serves both — meaning `npm run build:cua` is all a developer needs before the
 * tools appear.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = join(root, 'native-cua', 'Cargo.toml')
const built = join(root, 'native-cua', 'target', 'release', 'vespi-cua.exe')
const staged = join(root, 'resources', 'vespi-cua.exe')

if (!existsSync(manifest)) {
  console.error(`[build-cua] expected the helper crate at ${manifest}`)
  process.exit(1)
}

console.log('[build-cua] cargo build --release')
try {
  execFileSync('cargo', ['build', '--release', '--manifest-path', manifest], { stdio: 'inherit' })
} catch (error) {
  console.error('[build-cua] cargo failed. Install Rust (https://rustup.rs) and retry.')
  console.error(`[build-cua] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

if (!existsSync(built)) {
  console.error(`[build-cua] cargo reported success but ${built} does not exist`)
  process.exit(1)
}

mkdirSync(dirname(staged), { recursive: true })
copyFileSync(built, staged)
console.log(`[build-cua] staged ${staged} (${Math.round(statSync(staged).size / 1024)} KB)`)
