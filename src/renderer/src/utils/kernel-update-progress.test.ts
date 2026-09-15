import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import type { KernelUpdateProgress } from '../../../shared/ipc-contracts'
import { kernelUpdateBarPercent, kernelUpdateBusy, kernelUpdateLabel, visibleUpdateRows } from './kernel-update-progress'

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

describe('kernelUpdateLabel', () => {
  // The download phase is the longest one for BOTH channels, and its two message
  // keys used to be hard-coded to the kernel wording. A downloading VesPi update
  // therefore announced itself as "正在下载内核 xx%" — so both rows read alike and
  // the user could not tell which update was which. This is that regression.
  it('never describes the VesPi channel with the kernel wording', () => {
    for (const phase of ['checking', 'downloading', 'installing', 'done', 'error'] as const) {
      const ui = kernelUpdateLabel('zh', progress(phase), 'ui')
      const kernel = kernelUpdateLabel('zh', progress(phase), 'kernel')
      assert.ok(!ui.includes('内核'), `ui/${phase} read as the kernel: ${ui}`)
      assert.ok(kernel.includes('内核'), `kernel/${phase} lost its wording: ${kernel}`)
      assert.notEqual(ui, kernel, phase)
    }
  })

  it('names the channel while downloading with a byte breakdown', () => {
    const counted = { ...progress('downloading'), receivedBytes: 512, totalBytes: 1024 }
    const ui = kernelUpdateLabel('zh', counted, 'ui')
    const kernel = kernelUpdateLabel('zh', counted, 'kernel')
    assert.ok(ui.includes('VesPi'), ui)
    assert.ok(!ui.includes('内核'), ui)
    assert.ok(kernel.includes('内核'), kernel)
  })
})
