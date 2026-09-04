import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  checksumUrlForAsset,
  isNewerVersion,
  ompAssetName,
  parseSha256Sum,
  parseVersion,
  pickLatestRelease,
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
