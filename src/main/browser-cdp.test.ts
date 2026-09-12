import { strict as assert } from 'node:assert'
import { describe, it, afterEach } from 'node:test'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import {
  AGENT_BROWSER_PORT_ENV,
  BROWSER_CDP_OVERLAY_FILE,
  DEFAULT_AGENT_BROWSER_PORT,
  agentBrowserEnabledIn,
  agentBrowserLaunchArgs,
  agentBrowserSettingsCandidates,
  browserCdpKernelEnv,
  browserCdpOverlayPath,
  browserCdpOverlayYaml,
  chromeExecutableCandidates,
  ensureAgentBrowser,
  initAgentBrowser,
  pickChromeExecutable,
  readAgentBrowserEnabled,
  resetBrowserCdpState,
  resolveAgentBrowserPort,
  startAgentBrowser,
  withConfigFilesEnv,
} from './browser-cdp'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vespi-agentbrowser-'))
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

describe('resolveAgentBrowserPort', () => {
  it('defaults when nothing is set', () => {
    assert.equal(resolveAgentBrowserPort({}), DEFAULT_AGENT_BROWSER_PORT)
    assert.equal(resolveAgentBrowserPort({ [AGENT_BROWSER_PORT_ENV]: '  ' }), DEFAULT_AGENT_BROWSER_PORT)
  })

  it('honours a valid override', () => {
    assert.equal(resolveAgentBrowserPort({ [AGENT_BROWSER_PORT_ENV]: '9333' }), 9333)
  })

  // A malformed override must not stop startup, and must not bind a surprise port.
  it('falls back on anything malformed rather than throwing', () => {
    for (const bad of ['abc', '0', '-1', '65536', '12.5', '9223x']) {
      assert.equal(resolveAgentBrowserPort({ [AGENT_BROWSER_PORT_ENV]: bad }), DEFAULT_AGENT_BROWSER_PORT, bad)
    }
  })
})

describe('agentBrowserEnabledIn', () => {
  // The capability is the product goal, so "no opinion" has to mean enabled.
  it('defaults to enabled when the key is absent', () => {
    for (const value of [{}, { theme: 'dark' }, null, undefined]) {
      assert.equal(agentBrowserEnabledIn(value), true, JSON.stringify(value))
    }
  })

  it('honours an explicit choice either way', () => {
    assert.equal(agentBrowserEnabledIn({ agentBrowserEnabled: true }), true)
    assert.equal(agentBrowserEnabledIn({ agentBrowserEnabled: false }), false)
  })

  // A debugging port must not be opened on a corrupt value.
  it('fails closed on a value that is neither boolean nor absent', () => {
    for (const bad of ['yes', 'true', 1, 0]) {
      assert.equal(agentBrowserEnabledIn({ agentBrowserEnabled: bad }), false, JSON.stringify(bad))
    }
  })
})

describe('readAgentBrowserEnabled', () => {
  it('reads an explicit choice from the first existing file', () => {
    const dir = makeTempDir()
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ agentBrowserEnabled: false }), 'utf-8')
    assert.equal(readAgentBrowserEnabled([file]), false)
  })

  // A fresh install has no settings file and must still get the capability.
  it('is enabled when no candidate exists', () => {
    assert.equal(readAgentBrowserEnabled([join(makeTempDir(), 'missing.json')]), true)
  })

  it('is enabled for a settings file that predates this key', () => {
    const dir = makeTempDir()
    const file = join(dir, 'settings.json')
    writeFileSync(file, JSON.stringify({ theme: 'dark', language: 'zh' }), 'utf-8')
    assert.equal(readAgentBrowserEnabled([file]), true)
  })

  it('is false for a truncated file instead of borrowing a legacy answer', () => {
    const dir = makeTempDir()
    const broken = join(dir, 'settings.json')
    const legacy = join(dir, 'legacy.json')
    writeFileSync(broken, '{ "agentBrowserEnabled": tr', 'utf-8')
    writeFileSync(legacy, JSON.stringify({ agentBrowserEnabled: true }), 'utf-8')
    assert.equal(readAgentBrowserEnabled([broken, legacy]), false)
  })

  it('puts the canonical GUI data dir first', () => {
    const candidates = agentBrowserSettingsCandidates({
      guiDataDir: 'C:\\gui',
      appDataDir: 'C:\\appdata',
      homeDir: 'C:\\home',
    })
    assert.equal(candidates[0], join('C:\\gui', 'settings.json'))
    assert.ok(candidates.length > 1, 'legacy locations should still be offered')
  })
})

describe('chromeExecutableCandidates', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
    ProgramFiles: 'C:\\PF',
    'ProgramFiles(x86)': 'C:\\PF86',
  }

  // Chrome is the preferred engine, so it must win regardless of install root.
  it('prefers Chrome over the Chromium alternatives', () => {
    const candidates = chromeExecutableCandidates(env)
    const chrome = candidates.findIndex((path) => path.includes(join('Google', 'Chrome')))
    const edge = candidates.findIndex((path) => path.includes(join('Microsoft', 'Edge')))
    assert.ok(chrome >= 0 && edge >= 0)
    assert.ok(chrome < edge, 'Chrome should be offered before Edge')
  })

  it('covers all three Windows install roots', () => {
    const candidates = chromeExecutableCandidates(env)
    assert.ok(candidates.some((path) => path.startsWith(env.LOCALAPPDATA)))
    assert.ok(candidates.some((path) => path.startsWith(env.ProgramFiles)))
    assert.ok(candidates.some((path) => path.startsWith(env['ProgramFiles(x86)'])))
  })

  it('does not invent paths when the environment is empty', () => {
    assert.deepEqual(chromeExecutableCandidates({}), [])
  })
})

describe('pickChromeExecutable', () => {
  it('returns the first candidate that exists', () => {
    assert.equal(pickChromeExecutable(['/a', '/b'], (p) => p === '/b'), '/b')
  })

  it('returns null when nothing exists', () => {
    assert.equal(pickChromeExecutable(['/a'], () => false), null)
  })
})

describe('agentBrowserLaunchArgs', () => {
  it('opens a debugging port and isolates the profile', () => {
    const args = agentBrowserLaunchArgs(9223, 'C:\\gui\\agent-browser-profile')
    assert.ok(args.includes('--remote-debugging-port=9223'))
    assert.ok(args.includes('--user-data-dir=C:\\gui\\agent-browser-profile'))
  })

  // Without these the first launch shows a first-run tour instead of a page.
  it('suppresses first-run chrome', () => {
    const args = agentBrowserLaunchArgs(9223, 'p')
    assert.ok(args.includes('--no-first-run'))
    assert.ok(args.includes('--no-default-browser-check'))
  })

  // The whole point is that the user can see it.
  it('never passes a headless flag', () => {
    assert.ok(!agentBrowserLaunchArgs(9223, 'p').some((arg) => arg.includes('headless')))
  })
})

describe('withConfigFilesEnv', () => {
  it('sets the value when nothing was set before', () => {
    assert.equal(withConfigFilesEnv(undefined, '/a/overlay.yml'), '/a/overlay.yml')
    assert.equal(withConfigFilesEnv('', '/a/overlay.yml'), '/a/overlay.yml')
  })

  it('preserves an existing list and appends', () => {
    assert.equal(
      withConfigFilesEnv(['/x', '/y'].join(delimiter), '/a/overlay.yml'),
      ['/x', '/y', '/a/overlay.yml'].join(delimiter)
    )
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
    const yaml = browserCdpOverlayYaml(9223)
    assert.match(yaml, /browser:/)
    assert.match(yaml, /cdpUrl: "http:\/\/127\.0\.0\.1:9223"/)
  })

  it('does not override the relay setting, which takes precedence', () => {
    assert.doesNotMatch(browserCdpOverlayYaml(9223), /relay:/)
  })
})

/** Deterministic probe: nothing runs on its own, and time only advances on sleep. */
function makeProbe(options: { upAfter?: number; launchThrows?: boolean; executable?: string | null }): {
  probe: {
    isUp: () => Promise<boolean>
    pickExecutable: () => string | null
    launch: (executable: string, args: string[]) => void
    sleep: (ms: number) => Promise<void>
    now: () => number
  }
  launched: Array<{ executable: string; args: string[] }>
} {
  let clock = 0
  let upCount = 0
  const launched: Array<{ executable: string; args: string[] }> = []
  return {
    launched,
    probe: {
      isUp: async () => {
        upCount += 1
        return upCount > (options.upAfter ?? 0)
      },
      pickExecutable: () => (options.executable === undefined ? 'C:\\chrome.exe' : options.executable),
      launch: (executable: string, args: string[]) => {
        if (options.launchThrows) throw new Error('spawn failed')
        launched.push({ executable, args })
      },
      sleep: async (ms: number) => {
        clock += ms
      },
      now: () => clock,
    },
  }
}

describe('ensureAgentBrowser', () => {
  it('reuses a browser that is already listening', async () => {
    const { probe, launched } = makeProbe({ upAfter: 0 })
    assert.equal(await ensureAgentBrowser({ port: 9223, profileDir: 'p', probe }), 'reused')
    assert.equal(launched.length, 0, 'must not launch a second browser on the same port')
  })

  it('launches and waits for the browser to answer', async () => {
    const { probe, launched } = makeProbe({ upAfter: 1 })
    assert.equal(await ensureAgentBrowser({ port: 9223, profileDir: 'p', probe }), 'launched')
    assert.equal(launched.length, 1)
    assert.ok(launched[0].args.includes('--remote-debugging-port=9223'))
  })

  it('reports unavailable when no browser is installed', async () => {
    const { probe, launched } = makeProbe({ upAfter: 99, executable: null })
    assert.equal(await ensureAgentBrowser({ port: 9223, profileDir: 'p', probe }), 'unavailable')
    assert.equal(launched.length, 0)
  })

  it('reports unavailable when the launch throws', async () => {
    const { probe } = makeProbe({ upAfter: 99, launchThrows: true })
    assert.equal(await ensureAgentBrowser({ port: 9223, profileDir: 'p', probe }), 'unavailable')
  })

  it('gives up rather than waiting forever', async () => {
    const { probe } = makeProbe({ upAfter: 999999 })
    assert.equal(await ensureAgentBrowser({ port: 9223, profileDir: 'p', probe }), 'unavailable')
  })
})

describe('initAgentBrowser', () => {
  it('is on out of the box, with no settings file at all', () => {
    const guiDataDir = makeTempDir()
    const result = initAgentBrowser({ guiDataDir, appDataDir: guiDataDir, homeDir: guiDataDir })
    assert.equal(result.enabled, true)
    assert.equal(result.port, DEFAULT_AGENT_BROWSER_PORT)
    // Enabling is not the same as wiring: that waits for the endpoint to answer.
    assert.deepEqual(browserCdpKernelEnv(), {})
  })

  it('stays off when settings explicitly disable it', () => {
    const guiDataDir = makeTempDir()
    writeFileSync(join(guiDataDir, 'settings.json'), JSON.stringify({ agentBrowserEnabled: false }), 'utf-8')
    const result = initAgentBrowser({ guiDataDir, appDataDir: guiDataDir, homeDir: guiDataDir })
    assert.deepEqual(result, { enabled: false, port: null })
    assert.deepEqual(browserCdpKernelEnv(), {})
  })
})

describe('startAgentBrowser', () => {
  it('writes the overlay and wires the kernel once the browser answers', async () => {
    const guiDataDir = makeTempDir()
    const { probe } = makeProbe({ upAfter: 1 })

    const status = await startAgentBrowser({ guiDataDir, port: 9223, probe })

    assert.equal(status, 'launched')
    const overlay = browserCdpOverlayPath(guiDataDir)
    assert.ok(overlay.endsWith(BROWSER_CDP_OVERLAY_FILE), overlay)
    assert.equal(readFileSync(overlay, 'utf-8'), browserCdpOverlayYaml(9223))
    assert.equal(browserCdpKernelEnv().PI_CONFIG_FILES, overlay)
  })

  it('appends to an existing config list rather than replacing it', async () => {
    const guiDataDir = makeTempDir()
    const { probe } = makeProbe({ upAfter: 0 })

    await startAgentBrowser({ guiDataDir, port: 9223, probe, env: { PI_CONFIG_FILES: '/user/own.yml' } })

    assert.equal(
      browserCdpKernelEnv().PI_CONFIG_FILES,
      ['/user/own.yml', browserCdpOverlayPath(guiDataDir)].join(delimiter)
    )
  })

  // Never point the kernel at an endpoint nobody is listening on.
  it('leaves the kernel alone when no browser is available', async () => {
    const guiDataDir = makeTempDir()
    const { probe } = makeProbe({ upAfter: 99, executable: null })

    const status = await startAgentBrowser({ guiDataDir, port: 9223, probe })

    assert.equal(status, 'unavailable')
    assert.deepEqual(browserCdpKernelEnv(), {})
    assert.equal(existsSync(browserCdpOverlayPath(guiDataDir)), false)
  })

  it('leaves the kernel alone when the overlay cannot be written', async () => {
    const { probe } = makeProbe({ upAfter: 0 })
    const status = await startAgentBrowser({ guiDataDir: makeUnwritableDir(), port: 9223, probe })
    assert.equal(status, 'unavailable')
    assert.deepEqual(browserCdpKernelEnv(), {})
  })

  it('reports its status so the app log can explain a missing browser', async () => {
    const guiDataDir = makeTempDir()
    const { probe } = makeProbe({ upAfter: 0 })
    const seen: string[] = []
    await startAgentBrowser({ guiDataDir, port: 9223, probe, onStatus: (status) => seen.push(status) })
    assert.deepEqual(seen, ['reused'])
  })

  it('exposes the kernel env as a copy, so callers cannot mutate the state', async () => {
    const guiDataDir = makeTempDir()
    const { probe } = makeProbe({ upAfter: 0 })
    await startAgentBrowser({ guiDataDir, port: 9223, probe })

    browserCdpKernelEnv().PI_CONFIG_FILES = 'tampered'
    assert.equal(browserCdpKernelEnv().PI_CONFIG_FILES, browserCdpOverlayPath(guiDataDir))
  })

  it('creates the profile directory before launching', async () => {
    const guiDataDir = makeTempDir()
    const { probe, launched } = makeProbe({ upAfter: 1 })
    await startAgentBrowser({ guiDataDir, port: 9223, probe })
    assert.equal(launched.length, 1)
    assert.ok(existsSync(join(guiDataDir, 'agent-browser-profile')), 'profile dir should exist')
  })
})
