import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  PANEL_EXPRESSION_MAX_CHARS,
  PANEL_SCREENSHOT_MAX_BYTES,
  PANEL_TEXT_MAX_CHARS,
  createPanelOps,
  panelEvalWrapper,
  type PanelGuestLike,
} from './panel-ops'
import type { PanelOp, PanelRequest } from './panel-channel'

type Call = [string, ...unknown[]]

function makeGuest(overrides: Partial<PanelGuestLike> = {}): { guest: PanelGuestLike; calls: Call[] } {
  const calls: Call[] = []
  const guest: PanelGuestLike = {
    isDestroyed: () => false,
    getURL: () => 'https://example.com/',
    getTitle: () => 'Example Domain',
    isLoading: () => false,
    canGoBack: () => false,
    canGoForward: () => false,
    loadURL: async (url: string) => {
      calls.push(['loadURL', url])
    },
    reload: () => {
      calls.push(['reload'])
    },
    goBack: () => {
      calls.push(['goBack'])
    },
    goForward: () => {
      calls.push(['goForward'])
    },
    executeJavaScript: async (code: string, userGesture?: boolean) => {
      calls.push(['executeJavaScript', code, userGesture])
      return 42
    },
    capturePage: async () => ({
      isEmpty: () => false,
      toPNG: () => Buffer.from([1, 2, 3]),
    }),
    ...overrides,
  }
  return { guest, calls }
}

function makeOps(options: { guest?: PanelGuestLike | null; overrides?: Partial<PanelGuestLike> } = {}) {
  const made = options.overrides ? makeGuest(options.overrides) : options.guest !== undefined ? null : makeGuest()
  const guest = options.guest !== undefined ? options.guest : (made as { guest: PanelGuestLike }).guest
  const calls = made ? made.calls : []
  // Every call the shell was asked to make, so tests can assert that reads stay
  // invisible and that nothing is asked for before validation passes.
  const requests: Array<string | undefined> = []
  const run = createPanelOps({
    getGuest: () => guest,
    requestPanel: (url) => {
      requests.push(url)
    },
  })
  return {
    calls,
    requests,
    call: (op: PanelOp, payload: Record<string, unknown> = {}) => run({ op, payload } as PanelRequest),
  }
}

describe('panelEvalWrapper', () => {
  it('awaits the expression and JSON-projects the value', () => {
    const code = panelEvalWrapper('Promise.resolve({ a: 1 })')
    assert.match(code, /await/)
    assert.match(code, /JSON\.parse\(JSON\.stringify\(value\)\)/)
    assert.match(code, /Promise\.resolve/)
  })

  // undefined cannot survive JSON, so it has to become null explicitly.
  it('turns undefined into null', () => {
    assert.match(panelEvalWrapper('1 + 1'), /return null/)
  })

  // A trailing newline keeps a trailing line comment from eating the closer.
  it('keeps the expression on its own line', () => {
    assert.match(panelEvalWrapper('1 // note'), /\n1 \/\/ note\n/)
  })
})

describe('panel state', () => {
  it('reports where the panel is', async () => {
    const ops = makeOps()
    assert.deepEqual(await ops.call('state'), {
      url: 'https://example.com/',
      title: 'Example Domain',
      loading: false,
      canGoBack: false,
      canGoForward: false,
    })
  })

  it('explains itself when the panel is not open', async () => {
    const ops = makeOps({ guest: null })
    await assert.rejects(() => ops.call('state'), /call panel_open first/)
  })

  // A destroyed guest is a stale reference, not a usable panel.
  it('refuses a destroyed guest', async () => {
    const ops = makeOps({ overrides: { isDestroyed: () => true } })
    await assert.rejects(() => ops.call('state'), /call panel_open first/)
  })
})

describe('panel open', () => {
  // Navigation goes through the shell, not guest.loadURL: the panel's <webview>
  // only exists once it has a URL, and the address bar is driven by that state.
  it('asks the shell to show the panel at that url', async () => {
    const ops = makeOps()
    const result = await ops.call('open', { url: 'https://example.org/a' })
    assert.deepEqual(ops.requests, ['https://example.org/a'])
    assert.deepEqual(ops.calls, [], 'the guest is not driven directly')
    assert.deepEqual(result, { url: 'https://example.org/a', requested: true })
  })

  it('accepts http as well as https', async () => {
    const ops = makeOps()
    await ops.call('open', { url: 'http://localhost:8080/x' })
    assert.deepEqual(ops.requests, ['http://localhost:8080/x'])
  })

  it('requires a url', async () => {
    const ops = makeOps()
    await assert.rejects(() => ops.call('open', {}), /url is required/)
    await assert.rejects(() => ops.call('open', { url: '   ' }), /url is required/)
    assert.deepEqual(ops.requests, [])
  })

  // The panel is a web client. Anything else — the local disk, a data: blob, a
  // script: URL — must never reach the shell, let alone the panel.
  it('refuses anything that is not http(s)', async () => {
    const ops = makeOps()
    for (const url of [
      'file:///C:/Windows/win.ini',
      'javascript:alert(1)',
      'data:text/html,<h1>x</h1>',
      'ftp://example.com/f',
      'chrome://settings',
      'C:////Windows////win.ini',
      'not a url',
    ]) {
      await assert.rejects(() => ops.call('open', { url }), /only http\(s\)/, url)
    }
    assert.deepEqual(ops.requests, [], 'nothing may be requested')
  })
})

describe('panel navigation', () => {
  it('reloads and brings the panel into view', async () => {
    const ops = makeOps()
    await ops.call('reload')
    assert.deepEqual(ops.calls, [['reload']])
    assert.deepEqual(ops.requests, [undefined])
  })

  it('goes back only when there is history', async () => {
    const blocked = makeOps()
    assert.deepEqual(await blocked.call('back'), { moved: false, url: 'https://example.com/' })
    assert.deepEqual(blocked.calls, [])
    // Bringing it into view is fine even when there is nowhere to go.
    assert.deepEqual(blocked.requests, [undefined])

    const allowed = makeOps({ overrides: { canGoBack: () => true } })
    assert.deepEqual(await allowed.call('back'), { moved: true })
    assert.deepEqual(allowed.calls, [['goBack']])
  })

  it('goes forward only when there is history', async () => {
    const blocked = makeOps()
    assert.deepEqual(await blocked.call('forward'), { moved: false, url: 'https://example.com/' })

    const allowed = makeOps({ overrides: { canGoForward: () => true } })
    assert.deepEqual(await allowed.call('forward'), { moved: true })
    assert.deepEqual(allowed.calls, [['goForward']])
  })
})

describe('panel eval', () => {
  it('runs the expression as a user gesture and returns the value', async () => {
    const ops = makeOps()
    assert.deepEqual(await ops.call('eval', { expression: '1 + 1' }), { value: 42 })
    const [name, code, gesture] = ops.calls[0]
    assert.equal(name, 'executeJavaScript')
    assert.equal(gesture, true)
    assert.match(String(code), /1 \+ 1/)
  })

  it('requires an expression', async () => {
    const ops = makeOps()
    await assert.rejects(() => ops.call('eval', {}), /expression is required/)
    assert.deepEqual(ops.calls, [])
  })

  it('refuses an expression past the size limit', async () => {
    const ops = makeOps()
    await assert.rejects(
      () => ops.call('eval', { expression: 'x'.repeat(PANEL_EXPRESSION_MAX_CHARS + 1) }),
      /too long/
    )
    assert.deepEqual(ops.calls, [])
  })
})

describe('panel text', () => {
  it('returns visible text', async () => {
    const ops = makeOps({ overrides: { executeJavaScript: async () => 'hello' } })
    assert.deepEqual(await ops.call('text'), { text: 'hello' })
  })

  it('truncates a huge page and says so', async () => {
    const ops = makeOps({ overrides: { executeJavaScript: async () => 'x'.repeat(PANEL_TEXT_MAX_CHARS + 500) } })
    const result = (await ops.call('text')) as { text: string; truncated: boolean; totalChars: number }
    assert.equal(result.text.length, PANEL_TEXT_MAX_CHARS)
    assert.equal(result.truncated, true)
    assert.equal(result.totalChars, PANEL_TEXT_MAX_CHARS + 500)
  })

  it('survives a page with no body', async () => {
    const ops = makeOps({ overrides: { executeJavaScript: async () => null } })
    assert.deepEqual(await ops.call('text'), { text: '' })
  })
})

describe('panel screenshot', () => {
  it('returns a base64 PNG', async () => {
    const ops = makeOps()
    const result = (await ops.call('screenshot')) as { imagePngBase64: string; bytes: number }
    assert.equal(result.imagePngBase64, Buffer.from([1, 2, 3]).toString('base64'))
    assert.equal(result.bytes, 3)
  })

  it('refuses an empty capture', async () => {
    const ops = makeOps({ overrides: { capturePage: async () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }) } })
    await assert.rejects(() => ops.call('screenshot'), /not showing anything to capture/)
  })

  it('refuses an implausibly large capture', async () => {
    const ops = makeOps({
      overrides: {
        capturePage: async () => ({ isEmpty: () => false, toPNG: () => Buffer.alloc(PANEL_SCREENSHOT_MAX_BYTES + 1) }),
      },
    })
    await assert.rejects(() => ops.call('screenshot'), /too large/)
  })
})

describe('panel visibility', () => {
  // The user asked to see what the model does, so acting on the page brings the
  // panel up.
  it('asks for the panel when acting on the page', async () => {
    for (const op of ['open', 'reload', 'back', 'forward', 'eval'] as const) {
      const ops = makeOps({ overrides: { canGoBack: () => true, canGoForward: () => true } })
      await ops.call(op, op === 'open' ? { url: 'https://example.com/' } : op === 'eval' ? { expression: '1' } : {})
      assert.equal(ops.requests.length, 1, op)
    }
  })

  // A model polling the page must not keep yanking the user back to the panel.
  it('stays invisible for reads', async () => {
    for (const op of ['state', 'text', 'screenshot'] as const) {
      const ops = makeOps()
      await ops.call(op)
      assert.deepEqual(ops.requests, [], op)
    }
  })
})
