import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import type { KernelUpdateProgress } from '../../../shared/ipc-contracts'
import { kernelUpdateBarPercent, kernelUpdateBusy, visibleUpdateRows } from './kernel-update-progress'

const progress = (phase: KernelUpdateProgress['phase']): KernelUpdateProgress => ({
  phase,
  percent: 50,
  receivedBytes: 0,
  totalBytes: 0,
})

describe('kernelUpdateBusy', () => {
  it('is true while an install is in flight', () => {
    for (const phase of ['checking', 'downloading', 'installing', 'restarting'] as const) {
      assert.equal(kernelUpdateBusy(progress(phase)), true, phase)
    }
  })

  it('is false when idle, finished, or failed', () => {
    assert.equal(kernelUpdateBusy(null), false)
    assert.equal(kernelUpdateBusy(progress('done')), false)
    assert.equal(kernelUpdateBusy(progress('error')), false)
  })
})

describe('visibleUpdateRows', () => {
  const base = { uiAvailable: false, kernelAvailable: false, uiProgress: null, kernelProgress: null }

  it('shows nothing when neither channel has anything to say', () => {
    assert.deepEqual(visibleUpdateRows(base), { ui: false, kernel: false })
  })

  it('shows one line per available release', () => {
    assert.deepEqual(visibleUpdateRows({ ...base, uiAvailable: true }), { ui: true, kernel: false })
    assert.deepEqual(visibleUpdateRows({ ...base, kernelAvailable: true }), { ui: false, kernel: true })
    assert.deepEqual(visibleUpdateRows({ ...base, uiAvailable: true, kernelAvailable: true }), {
      ui: true,
      kernel: true,
    })
  })

  it('keeps a line visible while its own install runs, even before a release is known', () => {
    assert.deepEqual(visibleUpdateRows({ ...base, uiProgress: progress('downloading') }), {
      ui: true,
      kernel: false,
    })
    // A finished or failed install still reports something, so its line stays.
    assert.deepEqual(visibleUpdateRows({ ...base, kernelProgress: progress('done') }), {
      ui: false,
      kernel: true,
    })
    assert.deepEqual(visibleUpdateRows({ ...base, kernelProgress: progress('error') }), {
      ui: false,
      kernel: true,
    })
  })

  // The regression: one channel's progress must never hide the other's line.
  it('does not let one channel hide the other', () => {
    assert.deepEqual(
      visibleUpdateRows({ ...base, uiAvailable: true, kernelAvailable: true, kernelProgress: progress('downloading') }),
      { ui: true, kernel: true }
    )
    assert.deepEqual(
      visibleUpdateRows({ ...base, uiAvailable: true, kernelAvailable: true, uiProgress: progress('installing') }),
      { ui: true, kernel: true }
    )
  })
})

describe('kernelUpdateBarPercent', () => {
  it('never returns a fraction that reads as "nothing happening"', () => {
    assert.equal(kernelUpdateBarPercent(null), 0)
    assert.ok(kernelUpdateBarPercent(progress('checking')) > 0)
    assert.ok(kernelUpdateBarPercent(progress('downloading')) > 0)
  })

  it('is full once the work is past downloading', () => {
    assert.equal(kernelUpdateBarPercent(progress('installing')), 100)
    assert.equal(kernelUpdateBarPercent(progress('restarting')), 100)
    assert.equal(kernelUpdateBarPercent(progress('done')), 100)
  })
})
