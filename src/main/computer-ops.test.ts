import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { createComputerOps, DEFAULT_CAPTURE_EDGE, MAX_CAPTURE_EDGE, MAX_TYPE_CHARS } from './computer-ops'

/**
 * The policy in `computer-ops` is the only thing between a model and the user's
 * real desktop, so these tests are about refusals as much as about results: the
 * allow-list, VesPi's own window, and the bounds all have to hold.
 */

interface Call {
  method: string
  params: Record<string, unknown>
}

const WINDOWS = [
  { id: 0, handle: 100, title: 'Untitled - Notepad', process: 'notepad.exe', pid: 10, x: 10, y: 20, width: 800, height: 600, minimized: false, focused: true },
  { id: 1, handle: 200, title: 'VesPi', process: 'VesPi.exe', pid: 20, x: 100, y: 100, width: 1200, height: 800, minimized: false, focused: false },
]

function makeOps(options: { allowedApps?: string[]; windows?: typeof WINDOWS } = {}) {
  const calls: Call[] = []
  const call = async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ method, params })
    switch (method) {
      case 'list_windows':
        return { windows: options.windows ?? WINDOWS, count: (options.windows ?? WINDOWS).length }
      case 'screen_info':
        return { width: 1920, height: 1080, desktop: { x: 0, y: 0, width: 3840, height: 1080, monitors: 2 }, cursor: { x: 0, y: 0 } }
      case 'capture':
        return { pngBase64: 'AAAA', width: 100, height: 100, origin: { x: 0, y: 0 }, scale: 1, source: { kind: 'window' } }
      case 'uitree':
        return { elements: [], count: 0 }
      default:
        return { method, params }
    }
  }

  const run = createComputerOps({
    call,
    allowedApps: () => options.allowedApps ?? [],
    selfProcess: 'VesPi.exe',
    slowTimeoutMs: 1000,
  })
  return { run, calls }
}

describe('computer ops: window listing', () => {
  it('marks VesPi itself as not actionable while still reporting it', async () => {
    const { run } = makeOps()
    const result = (await run('windows', {})) as { windows: Array<{ process: string; actionable: boolean; note?: string }> }

    const self = result.windows.find((row) => row.process === 'VesPi.exe')
    assert.ok(self, 'VesPi should still appear in the list')
    assert.equal(self.actionable, false)
    assert.match(String(self.note), /VesPi itself/)

    const other = result.windows.find((row) => row.process === 'notepad.exe')
    assert.equal(other?.actionable, true)
  })

  it('reports the allow-list so the model can see the boundary', async () => {
    const { run } = makeOps({ allowedApps: ['notepad.exe'] })
    const result = (await run('windows', {})) as { allowedApps: string[] }
    assert.deepEqual(result.allowedApps, ['notepad.exe'])
  })
})

describe('computer ops: refusing to drive VesPi', () => {
  for (const op of ['focus', 'capture', 'uitree']) {
    it(`refuses ${op} on VesPi's own window`, async () => {
      const { run } = makeOps()
      await assert.rejects(() => run(op, { handle: 200 }), /VesPi itself/)
    })
  }

  it('refuses a click while VesPi holds focus', async () => {
    const { run } = makeOps({
      windows: [{ ...WINDOWS[1], focused: true } as (typeof WINDOWS)[number]],
    })
    await assert.rejects(() => run('click', { x: 100, y: 100 }), /VesPi itself/)
  })

  it('refuses typing while VesPi holds focus', async () => {
    const { run } = makeOps({
      windows: [{ ...WINDOWS[1], focused: true } as (typeof WINDOWS)[number]],
    })
    await assert.rejects(() => run('type', { text: 'hello' }), /VesPi itself/)
  })
})

describe('computer ops: the allow-list', () => {
  it('allows a window whose process is listed', async () => {
    const { run, calls } = makeOps({ allowedApps: ['notepad.exe'] })
    await run('capture', { handle: 100 })
    assert.ok(calls.some((entry) => entry.method === 'capture'))
  })

  it('refuses a window whose process is not listed', async () => {
    const { run } = makeOps({ allowedApps: ['chrome.exe'] })
    await assert.rejects(() => run('capture', { handle: 100 }), /not on the allowed application list/)
  })

  it('refuses input when the focused window is not listed', async () => {
    const { run } = makeOps({ allowedApps: ['chrome.exe'] })
    await assert.rejects(() => run('click', { x: 5, y: 5 }), /not on the allowed application list/)
  })

  it('an empty allow-list means unrestricted, not deny-all', async () => {
    const { run } = makeOps({ allowedApps: [] })
    await assert.doesNotReject(() => run('click', { x: 5, y: 5 }))
  })
})

describe('computer ops: bounds', () => {
  it('clamps a screenshot request to the maximum edge', async () => {
    const { run, calls } = makeOps()
    await run('capture', { handle: 100, max: 99_999 })
    const capture = calls.find((entry) => entry.method === 'capture')
    assert.equal(capture?.params.max, MAX_CAPTURE_EDGE)
  })

  it('defaults the screenshot edge when none is given', async () => {
    const { run, calls } = makeOps()
    await run('capture', { handle: 100 })
    assert.equal(calls.find((entry) => entry.method === 'capture')?.params.max, DEFAULT_CAPTURE_EDGE)
  })

  it('rejects text longer than the cap', async () => {
    const { run } = makeOps()
    await assert.rejects(() => run('type', { text: 'x'.repeat(MAX_TYPE_CHARS + 1) }), /text is too long/)
  })

  it('rejects a coordinate outside the desktop', async () => {
    const { run } = makeOps()
    await assert.rejects(() => run('click', { x: 5000, y: 10 }), /outside the desktop/)
  })

  it('accepts a coordinate on a second monitor', async () => {
    const { run, calls } = makeOps()
    await run('click', { x: 3000, y: 500 })
    assert.ok(calls.some((entry) => entry.method === 'click'))
  })
})

describe('computer ops: required arguments', () => {
  it('rejects a click without coordinates', async () => {
    const { run } = makeOps()
    await assert.rejects(() => run('click', {}), /x is required/)
  })

  it('rejects an unknown operation', async () => {
    const { run } = makeOps()
    await assert.rejects(() => run('launch_missiles', {}), /unknown operation/)
  })

  it('reports a stale window index instead of acting on another window', async () => {
    const { run } = makeOps()
    await assert.rejects(() => run('capture', { window: 9 }), /no window at index 9/)
  })
})

describe('computer ops: capture without a target', () => {
  it('captures the whole desktop and skips the window lookup', async () => {
    const { run, calls } = makeOps()
    await run('capture', {})
    const capture = calls.find((entry) => entry.method === 'capture')
    assert.ok(capture)
    assert.equal(capture.params.handle, undefined)
  })
})
