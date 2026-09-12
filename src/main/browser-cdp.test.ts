import { strict as assert } from 'node:assert'
import { describe, it, afterEach } from 'node:test'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import {
  DEFAULT_BROWSER_CDP_PORT,
  BROWSER_CDP_PORT_ENV,
  BROWSER_CDP_OVERLAY_FILE,
  browserCdpConfigFilesValue,
  browserCdpEnabledIn,
  browserCdpKernelEnv,
  browserCdpOverlayPath,
  browserCdpOverlayYaml,
  browserCdpSettingsCandidates,
  describeTargets,
  initBrowserCdp,
  pickPanelTarget,
  readBrowserCdpEnabled,
  resetBrowserCdpState,
  resolveBrowserCdpPort,
  startBrowserCdpWatch,
  withConfigFilesEnv,
  type CdpTargetInfo,
} from './browser-cdp'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vespi-cdp-'))
  tempDirs.push(dir)
  return dir
}

/** A guiDataDir that exists as a file, so mkdir/write cannot succeed. */
function makeUnwritableDir(): string {
  const dir = makeTempDir()
  const asFile = join(dir, 'not-a-dir')
  writeFileSync(asFile, 'x', 'utf-8')
  return asFile
}

afterEach(() => {
  resetBrowserCdpState()
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
})

describe('resolveBrowserCdpPort', () => {
  it('defaults when nothing is set', () => {
    assert.equal(resolveBrowserCdpPort({}), DEFAULT_BROWSER_CDP_PORT)
    assert.equal(resolveBrowserCdpPort({ [BROWSER_CDP_PORT_ENV]: '   ' }), DEFAULT_BROWSER_CDP_PORT)
  })

  it('honours a valid override', () => {
    assert.equal(resolveBrowserCdpPort({ [BROWSER_CDP_PORT_ENV]: '9444' }), 9444)
  })

  // A malformed override must not stop startup, and must not bind a surprise port.
  it('falls back on anything malformed rather than throwing', () => {
    for (const bad of ['abc', '0', '-1', '65536', '12.5', '9333x']) {
      assert.equal(resolveBrowserCdpPort({ [BROWSER_CDP_PORT_ENV]: bad }), DEFAULT_BROWSER_CDP_PORT, bad)
    }
  })
})

describe('browserCdpEnabledIn', () => {
  // The capability is the product goal, so "no opinion" has to mean enabled.
  it('defaults to enabled when the key is absent', () => {
    for (const value of [{}, { theme: 'dark' }, null, undefined]) {
      assert.equal(browserCdpEnabledIn(value), true, JSON.stringify(value))
    }
  })

  it('honours an explicit choice either way', () => {
    assert.equal(browserCdpEnabledIn({ browserCdpEnabled: true }), true)
    assert.equal(browserCdpEnabledIn({ browserCdpEnabled: false }), false)
  })

  // An unauthenticated debugging port must not open on a corrupt value.
  it('fails closed on a value that is neither boolean nor absent', () => {
    for (const bad of ['yes', 'true', 1, 0]) {
      assert.equal(browserCdpEnabledIn({ browserCdpEnabled: bad }), false, JSON.stringify(bad))
    }
  })
})

describe('browserCdpSettingsCandidates', () => {
  it('puts the canonical GUI data dir first', () => {
    const candidates = browserCdpSettingsCandidates({
      guiDataDir: 'C:\\gui',
      appDataDir: 'C:\\appdata',
      homeDir: 'C:\\home',
    })
    assert.equal(candidates[0], join('C:\\gui', 'settings.json'))
    assert.ok(candidates.length > 1, 'legacy locations should still be offered')
  })
})

describe('readBrowserCdpEnabled', () => {
  it('reads an explicit choice from the first existing file', () => {
    const dir = makeTempDir()
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ browserCdpEnabled: false }), 'utf-8')
    assert.equal(readBrowserCdpEnabled([file]), false)
  })

  // A fresh install has no settings file and must still get the capability.
  it('is enabled when no candidate exists', () => {
    assert.equal(readBrowserCdpEnabled([join(makeTempDir(), 'missing.json')]), true)
  })

  it('is enabled for a settings file that predates this key', () => {
    const dir = makeTempDir()
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ theme: 'dark', language: 'zh' }), 'utf-8')
    assert.equal(readBrowserCdpEnabled([file]), true)
  })

  it('is false for a truncated file instead of borrowing a legacy answer', () => {
    const dir = makeTempDir()
    const broken = join(dir, 'settings.json')
    const legacy = join(dir, 'legacy.json')
    writeFileSync(broken, '{ "browserCdpEnabled": tr', 'utf-8')
    writeFileSync(legacy, JSON.stringify({ browserCdpEnabled: true }), 'utf-8')
    assert.equal(readBrowserCdpEnabled([broken, legacy]), false)
  })

  it('stops at the first readable file rather than OR-ing candidates together', () => {
    const dir = makeTempDir()
    const primary = join(dir, 'settings.json')
    const legacy = join(dir, 'legacy.json')
    writeFileSync(primary, JSON.stringify({ browserCdpEnabled: false }), 'utf-8')
    writeFileSync(legacy, JSON.stringify({ browserCdpEnabled: true }), 'utf-8')
    assert.equal(readBrowserCdpEnabled([primary, legacy]), false)
  })
})

describe('withConfigFilesEnv', () => {
  it('sets the value when nothing was set before', () => {
    assert.equal(withConfigFilesEnv(undefined, '/a/overlay.yml'), '/a/overlay.yml')
    assert.equal(withConfigFilesEnv('', '/a/overlay.yml'), '/a/overlay.yml')
  })

  // A user who already points OMP at their own overlays must keep them.
  it('preserves an existing list and appends', () => {
    assert.equal(withConfigFilesEnv(['/x', '/y'].join(delimiter), '/a/overlay.yml'), ['/x', '/y', '/a/overlay.yml'].join(delimiter))
  })

  it('is idempotent', () => {
    const once = withConfigFilesEnv('/x', '/a/overlay.yml')
    assert.equal(withConfigFilesEnv(once, '/a/overlay.yml'), once)
  })

  it('drops empty segments left by a trailing separator', () => {
    assert.equal(withConfigFilesEnv(`/x${delimiter}`, '/a/overlay.yml'), ['/x', '/a/overlay.yml'].join(delimiter))
  })
})

describe('browserCdpOverlayYaml', () => {
  it('points the browser tool at the loopback port', () => {
    const yaml = browserCdpOverlayYaml(9333)
    assert.match(yaml, /browser:/)
    assert.match(yaml, /cdpUrl: "http:\/\/127\.0\.0\.1:9333"/)
  })

  it('does not override the relay setting, which takes precedence', () => {
    assert.doesNotMatch(browserCdpOverlayYaml(9333), /relay:/)
  })
})

describe('initBrowserCdp', () => {
  // The point of the feature: a fresh install gets it without setup.
  it('is on out of the box, with no settings file at all', () => {
    const guiDataDir = makeTempDir()
    const result = initBrowserCdp({ guiDataDir, appDataDir: guiDataDir, homeDir: guiDataDir })
    assert.equal(result.enabled, true)
    assert.equal(result.port, DEFAULT_BROWSER_CDP_PORT)
    assert.equal(existsSync(browserCdpOverlayPath(guiDataDir)), true)
    // Opening the port is not the same as wiring the kernel. Until the watch
    // sees a drivable panel page, the kernel must not be pointed here at all:
    // its Electron attach path would otherwise pick the app's own renderer.
    assert.deepEqual(browserCdpKernelEnv(), {})
  })

  it('stays shut when settings explicitly disable it', () => {
    const guiDataDir = makeTempDir()
    writeFileSync(join(guiDataDir, 'settings.json'), JSON.stringify({ browserCdpEnabled: false }), 'utf-8')
    const result = initBrowserCdp({ guiDataDir, appDataDir: guiDataDir, homeDir: guiDataDir })
    assert.deepEqual(result, { enabled: false, port: null, overlayPath: null })
    assert.deepEqual(browserCdpKernelEnv(), {})
    assert.equal(existsSync(browserCdpOverlayPath(guiDataDir)), false)
  })

  it('opens the port and writes the overlay when the setting is on', () => {
    const guiDataDir = makeTempDir()
    writeFileSync(join(guiDataDir, 'settings.json'), JSON.stringify({ browserCdpEnabled: true }), 'utf-8')

    const result = initBrowserCdp({ guiDataDir, appDataDir: guiDataDir, homeDir: guiDataDir })

    assert.equal(result.enabled, true)
    assert.equal(result.port, DEFAULT_BROWSER_CDP_PORT)
    const overlay = result.overlayPath
    assert.ok(overlay)
    assert.ok(overlay.endsWith(BROWSER_CDP_OVERLAY_FILE), overlay)
    assert.equal(readFileSync(overlay, 'utf-8'), browserCdpOverlayYaml(DEFAULT_BROWSER_CDP_PORT))
    assert.deepEqual(browserCdpKernelEnv(), {})
  })

  it('honours the port override and appends to an existing config list', () => {
    const guiDataDir = makeTempDir()
    writeFileSync(join(guiDataDir, 'settings.json'), JSON.stringify({ browserCdpEnabled: true }), 'utf-8')

    initBrowserCdp({
      guiDataDir,
      appDataDir: guiDataDir,
      homeDir: guiDataDir,
      env: { PI_CONFIG_FILES: '/user/own.yml', [BROWSER_CDP_PORT_ENV]: '9444' },
    })

    assert.match(readFileSync(browserCdpOverlayPath(guiDataDir), 'utf-8'), /:9444"/)
    // A user who already points OMP at their own overlays keeps them.
    assert.equal(
      browserCdpConfigFilesValue(browserCdpOverlayPath(guiDataDir), { PI_CONFIG_FILES: '/user/own.yml' }),
      ['/user/own.yml', browserCdpOverlayPath(guiDataDir)].join(delimiter),
    )
  })

  // Never point the kernel at a file that was not written.
  it('reports itself off when the overlay cannot be written', () => {
    const result = initBrowserCdp({
      guiDataDir: makeUnwritableDir(),
      appDataDir: undefined,
      homeDir: undefined,
      env: { PI_CONFIG_FILES: '/user/own.yml' },
    })
    assert.deepEqual(result, { enabled: false, port: null, overlayPath: null })
    assert.deepEqual(browserCdpKernelEnv(), {})
  })

  it('exposes the kernel env as a copy, so callers cannot mutate the state', () => {
    browserCdpKernelEnv().PI_CONFIG_FILES = 'tampered'
    assert.deepEqual(browserCdpKernelEnv(), {})
  })
})

describe('pickPanelTarget', () => {
  const isApp = (url: string): boolean => url.includes('VesPi.exe') || url.includes('localhost:5173')

  // The kernel's Electron attach path only accepts `page`, so a `webview`
  // target is invisible to it no matter how correct the URL is.
  it('ignores targets the kernel cannot drive', () => {
    const targets: CdpTargetInfo[] = [
      { type: 'webview', url: 'https://example.com/panel' },
      { type: 'other', url: 'https://example.com/other' },
      { type: 'service_worker', url: 'https://example.com/sw' },
    ]
    assert.equal(pickPanelTarget(targets, isApp), null)
  })

  // The regression this whole guard exists for: VesPi's own renderer is a
  // `page` target, and driving it means clicking the user's own interface.
  it('never returns the application renderer', () => {
    const targets: CdpTargetInfo[] = [{ type: 'page', url: 'http://localhost:5173/index.html' }]
    assert.equal(pickPanelTarget(targets, isApp), null)
  })

  it('ignores non-http targets, such as the packaged renderer and file previews', () => {
    const targets: CdpTargetInfo[] = [
      { type: 'page', url: 'file:///C:/Program%20Files/VesPi/resources/app.asar/out/renderer/index.html' },
      { type: 'page', url: 'about:blank' },
      { type: 'page', url: 'devtools://devtools/bundled/inspector.html' },
    ]
    assert.equal(pickPanelTarget(targets, isApp), null)
  })

  it('returns an http(s) page target that is not the app', () => {
    const panel: CdpTargetInfo = { type: 'page', url: 'https://item.taobao.com/item.htm?id=1' }
    const targets: CdpTargetInfo[] = [
      { type: 'page', url: 'http://localhost:5173/index.html' },
      panel,
    ]
    assert.equal(pickPanelTarget(targets, isApp), panel)
  })

  it('survives malformed entries', () => {
    assert.equal(pickPanelTarget([{ type: 'page' }, {}], isApp), null)
  })
})

describe('describeTargets', () => {
  it('summarises what the endpoint offers, for the log', () => {
    const summary = describeTargets([
      { type: 'page', url: 'http://localhost:5173/index.html' },
      { type: 'webview', url: 'https://example.com/a' },
    ])
    assert.match(summary, /page:localhost:5173/)
    assert.match(summary, /webview:example\.com/)
  })

  it('says so when the endpoint lists nothing', () => {
    assert.equal(describeTargets([]), '(none)')
  })
})

describe('startBrowserCdpWatch', () => {
  const isApp = (url: string): boolean => url.includes('localhost:5173')

  // Deterministic scheduler: nothing runs until the test flushes it.
  function createClock(): {
    setTimer: (fn: () => void, ms: number) => NodeJS.Timeout
    clearTimer: () => void
    flush: () => Promise<void>
  } {
    let pending: Array<() => void> = []
    return {
      setTimer: (fn) => {
        pending.push(fn)
        return 0 as unknown as NodeJS.Timeout
      },
      clearTimer: () => {
        pending = []
      },
      flush: async () => {
        const due = pending
        pending = []
        for (const fn of due) await fn()
      },
    }
  }

  const appRenderer: CdpTargetInfo = { type: 'page', url: 'http://localhost:5173/index.html' }
  const panelPage: CdpTargetInfo = { type: 'page', url: 'https://item.taobao.com/item.htm?id=1' }

  it('wires the kernel once a drivable panel page shows up, and stops when it goes', async () => {
    const clock = createClock()
    let served: CdpTargetInfo[] = [appRenderer]
    const states: Array<{ attached: boolean; url: string | null }> = []

    const stop = startBrowserCdpWatch({
      port: DEFAULT_BROWSER_CDP_PORT,
      isAppRenderer: isApp,
      configFilesValue: '/gui/omp-browser-cdp.yml',
      listTargets: async () => served,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      onStateChange: (state) => states.push({ attached: state.attached, url: state.url }),
    })

    await clock.flush()
    assert.deepEqual(browserCdpKernelEnv(), {}, 'app renderer alone must not wire the kernel')

    served = [appRenderer, panelPage]
    await clock.flush()
    assert.equal(browserCdpKernelEnv().PI_CONFIG_FILES, '/gui/omp-browser-cdp.yml')
    assert.deepEqual(states.at(-1), { attached: true, url: panelPage.url })

    served = [appRenderer]
    await clock.flush()
    assert.deepEqual(browserCdpKernelEnv(), {}, 'the pointer must be taken away again')
    assert.deepEqual(states.at(-1), { attached: false, url: null })

    stop()
    assert.deepEqual(browserCdpKernelEnv(), {})
  })

  it('stays detached when the endpoint is unreachable', async () => {
    const clock = createClock()
    const stop = startBrowserCdpWatch({
      port: DEFAULT_BROWSER_CDP_PORT,
      isAppRenderer: isApp,
      configFilesValue: '/gui/omp-browser-cdp.yml',
      listTargets: async () => {
        throw new Error('ECONNREFUSED')
      },
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    })
    await clock.flush()
    assert.deepEqual(browserCdpKernelEnv(), {})
    stop()
  })

  it('reports state changes once, not on every poll', async () => {
    const clock = createClock()
    const states: boolean[] = []
    const stop = startBrowserCdpWatch({
      port: DEFAULT_BROWSER_CDP_PORT,
      isAppRenderer: isApp,
      configFilesValue: '/gui/omp-browser-cdp.yml',
      listTargets: async () => [panelPage],
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      onStateChange: (state) => states.push(state.attached),
    })
    await clock.flush()
    await clock.flush()
    await clock.flush()
    assert.deepEqual(states, [true])
    stop()
  })
})
