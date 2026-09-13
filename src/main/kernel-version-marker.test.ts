import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { join } from 'node:path'
import {
  INSTALLED_KERNEL_MARKER_NAME,
  formatInstalledKernelMarker,
  installedKernelMarkerPath,
  readInstalledKernelVersion,
} from './kernel-version-marker'

const STAT = { size: 161_370_112, mtimeMs: 1_700_000_000_000 }

describe('installedKernelMarkerPath', () => {
  it('sits beside the binary', () => {
    assert.equal(
      installedKernelMarkerPath(join('C:\\app', 'runtime', 'omp', 'omp.exe')),
      join('C:\\app', 'runtime', 'omp', INSTALLED_KERNEL_MARKER_NAME)
    )
  })

  // `scripts/update-omp.mjs` and the release gate own `.version`; two formats
  // under one name would be a trap.
  it('does not reuse the packaging metadata name', () => {
    assert.notEqual(INSTALLED_KERNEL_MARKER_NAME, '.version')
  })
})

describe('readInstalledKernelVersion', () => {
  it('returns the version a marker records for this binary', () => {
    const marker = formatInstalledKernelMarker('18.1.19', STAT)
    assert.equal(readInstalledKernelVersion(marker, STAT), '18.1.19')
  })

  it('round-trips through the formatter', () => {
    const marker = formatInstalledKernelMarker('1.2.3-rc.1', STAT)
    assert.equal(readInstalledKernelVersion(marker, { ...STAT }), '1.2.3-rc.1')
  })

  it('is null without a marker or without the binary', () => {
    assert.equal(readInstalledKernelVersion(null, STAT), null)
    assert.equal(readInstalledKernelVersion('', STAT), null)
    assert.equal(readInstalledKernelVersion(formatInstalledKernelMarker('18.1.19', STAT), null), null)
  })

  // The whole safety property: a marker may not outlive the file it describes.
  it('is null once the binary it describes has changed', () => {
    const marker = formatInstalledKernelMarker('18.1.19', STAT)
    assert.equal(readInstalledKernelVersion(marker, { ...STAT, size: STAT.size + 1 }), null)
    assert.equal(readInstalledKernelVersion(marker, { ...STAT, mtimeMs: STAT.mtimeMs + 1 }), null)
  })

  it('is null for anything that is not a marker', () => {
    for (const bad of ['not json', '[]', 'null', '"18.1.19"', '{}', '{"version":""}']) {
      assert.equal(readInstalledKernelVersion(bad, STAT), null, bad)
    }
  })

  it('is null when the fingerprint fields are missing or the wrong type', () => {
    for (const bad of [
      '{"version":"18.1.19"}',
      '{"version":"18.1.19","size":"big","mtimeMs":1}',
      '{"version":"18.1.19","size":1}',
      '{"size":1,"mtimeMs":1}',
    ]) {
      assert.equal(readInstalledKernelVersion(bad, STAT), null, bad)
    }
  })

  it('accepts a marker with extra fields, so later additions stay readable', () => {
    const marker = JSON.stringify({ version: '18.1.19', size: STAT.size, mtimeMs: STAT.mtimeMs, note: 'x' })
    assert.equal(readInstalledKernelVersion(marker, STAT), '18.1.19')
  })
})
