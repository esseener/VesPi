import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isNewerVersion, ompAssetName, parseVersion, vespiInstallerAssetName } from './update-handlers'

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
