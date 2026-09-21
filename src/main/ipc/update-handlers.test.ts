import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checksumUrlForAsset,
  isNewerVersion,
  ompAssetName,
  parseSha256Sum,
  parseVersion,
  pickLatestRelease,
  pruneUiUpdateCache,
  shouldKeepUiUpdateEntry,
  uiUpdateCacheDir,
  vespiInstallerAssetName,
} from './update-handlers'

test('parseVersion strips omp/ prefix', () => {
  assert.deepEqual(parseVersion('omp/18.0.11').core, [18, 0, 11])
  assert.deepEqual(parseVersion('v18.1.2').core, [18, 1, 2])
})

test('isNewerVersion treats 18.1.2 as newer than 18.0.11', () => {
  assert.equal(isNewerVersion('18.1.2', '18.0.11'), true)
  assert.equal(isNewerVersion('18.0.11', '18.1.2'), false)
  assert.equal(isNewerVersion('18.1.2', '18.1.2'), false)
})

test('ompAssetName names the Windows x64 binary', () => {
  assert.equal(ompAssetName('win32', 'x64'), 'omp-windows-x64.exe')
  assert.equal(ompAssetName('darwin', 'arm64'), 'omp-darwin-arm64')
  assert.equal(ompAssetName('linux', 'x64'), 'omp-linux-x64')
})

test('vespiInstallerAssetName matches the published NSIS filename', () => {
  assert.equal(vespiInstallerAssetName('1.0.4', 'win32', 'x64'), 'VesPi-Setup-1.0.4-win-x64.exe')
  assert.equal(vespiInstallerAssetName('v1.0.4', 'win32', 'x64'), 'VesPi-Setup-1.0.4-win-x64.exe')
  assert.equal(vespiInstallerAssetName('1.0.4', 'linux', 'x64'), null)
})

test('prerelease comparison follows numeric SemVer identifiers', () => {
  assert.equal(isNewerVersion('1.0.0-rc.10', '1.0.0-rc.2'), true)
  assert.equal(isNewerVersion('1.0.0-rc.2', '1.0.0-rc.10'), false)
  assert.equal(isNewerVersion('1.0.0', '1.0.0-rc.10'), true)
})

test('release selection excludes prereleases by default', () => {
  const releases = [
    { tag_name: 'v1.1.0-rc.1', html_url: '', name: null, draft: false, prerelease: true },
    { tag_name: 'v1.0.9', html_url: '', name: null, draft: false, prerelease: false },
    { tag_name: 'v1.0.8', html_url: '', name: null, draft: false, prerelease: false },
  ]
  assert.equal(pickLatestRelease(releases)?.tag_name, 'v1.0.9')
  assert.equal(pickLatestRelease(releases, true)?.tag_name, 'v1.1.0-rc.1')
})

test('checksum helpers pin the manifest beside the release asset', () => {
  const url = 'https://github.com/example/app/releases/download/v1.0.0/VesPi-Setup-1.0.0-win-x64.exe?x=1'
  assert.equal(
    checksumUrlForAsset(url),
    'https://github.com/example/app/releases/download/v1.0.0/SHA256SUMS.txt',
  )
  const hash = 'a'.repeat(64)
  assert.equal(parseSha256Sum(`${hash}  VesPi-Setup-1.0.0-win-x64.exe\n`, 'VesPi-Setup-1.0.0-win-x64.exe'), hash)
  assert.equal(parseSha256Sum(`${hash}  other.exe\n`, 'VesPi-Setup-1.0.0-win-x64.exe'), null)
})

test('the installer cache is one fixed path, not a fresh temp dir per attempt', () => {
  // This is the fix for "the progress bar stops at 70 % and never moves": the
  // `.partN` files beside the installer are the resume state, so a directory that
  // changes identity between attempts guarantees every retry re-fetches 210 MB
  // from byte zero. A pointer to the same path twice is the whole contract.
  const dir = uiUpdateCacheDir()
  assert.equal(dir, join(tmpdir(), 'vespi-update'))
  assert.equal(uiUpdateCacheDir(), dir)
})

test('cache pruning keeps the target version and its ranges, drops the rest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vespi-update-test-'))
  const target = 'VesPi-Setup-1.0.56-win-x64.exe'
  try {
    writeFileSync(join(dir, target), 'installer')
    writeFileSync(join(dir, `${target}.part0`), 'range')
    writeFileSync(join(dir, `${target}.part5`), 'range')
    writeFileSync(join(dir, 'VesPi-Setup-1.0.55-win-x64.exe'), 'older installer')
    writeFileSync(join(dir, 'VesPi-Setup-1.0.55-win-x64.exe.part0'), 'older range')
    writeFileSync(join(dir, 'SHA256SUMS.txt'), 'noise')

    await pruneUiUpdateCache(dir, target)

    assert.deepEqual(readdirSync(dir).sort(), [target, `${target}.part0`, `${target}.part5`].sort())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('pruning a directory that does not exist yet is not an error', async () => {
  await assert.doesNotReject(() => pruneUiUpdateCache(join(tmpdir(), 'vespi-absent-cache-dir'), 'x.exe'))
})

test('shouldKeepUiUpdateEntry keeps only the target and its ranges', () => {
  const target = 'VesPi-Setup-1.0.56-win-x64.exe'
  assert.equal(shouldKeepUiUpdateEntry(target, target), true)
  assert.equal(shouldKeepUiUpdateEntry(`${target}.part0`, target), true)
  assert.equal(shouldKeepUiUpdateEntry(`${target}.part11`, target), true)
  assert.equal(shouldKeepUiUpdateEntry('VesPi-Setup-1.0.55-win-x64.exe', target), false)
  assert.equal(shouldKeepUiUpdateEntry('SHA256SUMS.txt', target), false)
})
