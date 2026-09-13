import { strict as assert } from 'node:assert'
import { describe, it, afterEach } from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_BROWSER_MCP_NAME,
  PANEL_MCP_NAME,
  browserMcpEntry,
  ensureAgentBrowserMcp,
  extraResourcePath,
  mergeMcpServerEntry,
  panelMcpEntry,
  removeAgentBrowserMcp,
  unpackedModulePath,
} from './agent-browser-mcp'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vespi-mcp-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
})

const baseEntry = (): Record<string, unknown> =>
  browserMcpEntry({
    nodeExecutable: 'C:\\app\\VesPi.exe',
    cliPath: 'C:\\app\\resources\\app.asar.unpacked\\node_modules\\@playwright\\mcp\\cli.js',
    endpoint: 'http://127.0.0.1:9223',
  })

describe('browserMcpEntry', () => {
  // The app's own executable doubles as Node only when this env var is set.
  it('runs the bundled server through the app executable as Node', () => {
    const entry = baseEntry()
    assert.equal(entry.type, 'stdio')
    assert.equal(entry.command, 'C:\\app\\VesPi.exe')
    assert.deepEqual((entry.env as Record<string, string>).ELECTRON_RUN_AS_NODE, '1')
  })

  it('points the server at the browser VesPi launched', () => {
    const args = baseEntry().args as string[]
    assert.ok(args.some((arg) => arg === '--cdp-endpoint=http://127.0.0.1:9223'), args.join(' '))
    assert.ok(args[0].endsWith(join('@playwright', 'mcp', 'cli.js')), args[0])
  })

  // The user's requirement: nothing may be downloaded on their machine.
  it('makes a browser download impossible', () => {
    const env = baseEntry().env as Record<string, string>
    assert.equal(env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, '1')
  })

  it('only pins an executable when one was found', () => {
    assert.ok(!(baseEntry().args as string[]).some((arg) => arg.startsWith('--executable-path')))
    const withExec = browserMcpEntry({
      nodeExecutable: 'n',
      cliPath: 'c',
      endpoint: 'e',
      executablePath: 'C:\\Chrome\\chrome.exe',
    })
    assert.ok((withExec.args as string[]).includes('--executable-path=C:\\Chrome\\chrome.exe'))
  })
})

describe('unpackedModulePath', () => {
  // An external process cannot read inside app.asar, so the packaged path must
  // point at the unpacked copy.
  it('resolves inside app.asar.unpacked when packaged', () => {
    const path = unpackedModulePath('C:\\app\\resources', true, 'C:\\app\\resources\\app.asar', '@playwright', 'mcp', 'cli.js')
    assert.equal(path, join('C:\\app\\resources', 'app.asar.unpacked', 'node_modules', '@playwright', 'mcp', 'cli.js'))
  })

  it('resolves to the plain node_modules tree when unpackaged', () => {
    const path = unpackedModulePath('/res', false, 'C:\\dev\\app', '@playwright', 'mcp', 'cli.js')
    assert.equal(path, join('C:\\dev\\app', 'node_modules', '@playwright', 'mcp', 'cli.js'))
  })
})

describe('mergeMcpServerEntry', () => {
  it('creates the servers map when the file is absent', () => {
    const parsed = JSON.parse(mergeMcpServerEntry(null, AGENT_BROWSER_MCP_NAME, baseEntry()))
    assert.deepEqual(Object.keys(parsed.mcpServers), [AGENT_BROWSER_MCP_NAME])
  })

  // Whatever else the user configured must survive.
  it('keeps other servers and unrelated top-level keys', () => {
    const existing = JSON.stringify({
      $schema: 'https://example.com/schema.json',
      mcpServers: { fofa: { type: 'stdio', command: 'uv' } },
    })
    const parsed = JSON.parse(mergeMcpServerEntry(existing, AGENT_BROWSER_MCP_NAME, baseEntry()))
    assert.deepEqual(Object.keys(parsed.mcpServers).sort(), ['browser', 'fofa'])
    assert.equal(parsed.$schema, 'https://example.com/schema.json')
    assert.equal(parsed.mcpServers.fofa.command, 'uv')
  })

  it('replaces a previous entry of the same name rather than duplicating it', () => {
    const existing = JSON.stringify({ mcpServers: { browser: { type: 'stdio', command: 'old' } } })
    const parsed = JSON.parse(mergeMcpServerEntry(existing, AGENT_BROWSER_MCP_NAME, baseEntry()))
    assert.equal(Object.keys(parsed.mcpServers).length, 1)
    assert.equal(parsed.mcpServers.browser.command, 'C:\\app\\VesPi.exe')
  })

  // The file is machine-written: refusing to fix it would silently disable the tools.
  it('replaces a malformed file instead of failing', () => {
    const parsed = JSON.parse(mergeMcpServerEntry('{ not json', AGENT_BROWSER_MCP_NAME, baseEntry()))
    assert.deepEqual(Object.keys(parsed.mcpServers), [AGENT_BROWSER_MCP_NAME])
  })

  it('is idempotent', () => {
    const once = mergeMcpServerEntry(null, AGENT_BROWSER_MCP_NAME, baseEntry())
    assert.equal(mergeMcpServerEntry(once, AGENT_BROWSER_MCP_NAME, baseEntry()), once)
  })

  it('ends with a newline', () => {
    assert.ok(mergeMcpServerEntry(null, AGENT_BROWSER_MCP_NAME, baseEntry()).endsWith('\n'))
  })
})

describe('ensureAgentBrowserMcp', () => {
  it('creates the file and its directory', () => {
    const dir = makeTempDir()
    const mcpPath = join(dir, 'nested', 'mcp.json')
    assert.equal(ensureAgentBrowserMcp({ mcpPath, entry: baseEntry() }), true)
    assert.ok(existsSync(mcpPath))
    const parsed = JSON.parse(readFileSync(mcpPath, 'utf-8'))
    assert.ok(parsed.mcpServers.browser)
  })

  it('preserves an existing unrelated server on disk', () => {
    const dir = makeTempDir()
    const mcpPath = join(dir, 'mcp.json')
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: { mine: { command: 'keep' } } }), 'utf-8')
    assert.equal(ensureAgentBrowserMcp({ mcpPath, entry: baseEntry() }), true)
    const parsed = JSON.parse(readFileSync(mcpPath, 'utf-8'))
    assert.deepEqual(Object.keys(parsed.mcpServers).sort(), ['browser', 'mine'])
  })

  // Failing to write costs the tools, not the app.
  it('reports failure instead of throwing when the path is unwritable', () => {
    const dir = makeTempDir()
    const asFile = join(dir, 'not-a-dir')
    writeFileSync(asFile, 'x', 'utf-8')
    assert.equal(ensureAgentBrowserMcp({ mcpPath: join(asFile, 'mcp.json'), entry: baseEntry() }), false)
  })

  it('leaves the file untouched when the entry is already correct', () => {
    const dir = makeTempDir()
    const mcpPath = join(dir, 'mcp.json')
    writeFileSync(mcpPath, mergeMcpServerEntry(null, AGENT_BROWSER_MCP_NAME, baseEntry()), 'utf-8')
    const before = readFileSync(mcpPath, 'utf-8')
    assert.equal(ensureAgentBrowserMcp({ mcpPath, entry: baseEntry() }), true)
    assert.equal(readFileSync(mcpPath, 'utf-8'), before)
  })
})

describe('removeAgentBrowserMcp', () => {
  it('removes only our entry', () => {
    const dir = makeTempDir()
    const mcpPath = join(dir, 'mcp.json')
    writeFileSync(
      mcpPath,
      mergeMcpServerEntry(JSON.stringify({ mcpServers: { mine: { command: 'keep' } } }), AGENT_BROWSER_MCP_NAME, baseEntry()),
      'utf-8'
    )
    assert.equal(removeAgentBrowserMcp({ mcpPath }), true)
    const parsed = JSON.parse(readFileSync(mcpPath, 'utf-8'))
    assert.deepEqual(Object.keys(parsed.mcpServers), ['mine'])
  })

  it('is a no-op when the file or entry is absent', () => {
    const dir = makeTempDir()
    assert.equal(removeAgentBrowserMcp({ mcpPath: join(dir, 'missing.json') }), true)
    const mcpPath = join(dir, 'mcp.json')
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: {} }), 'utf-8')
    assert.equal(removeAgentBrowserMcp({ mcpPath }), true)
    assert.equal(readFileSync(mcpPath, 'utf-8'), JSON.stringify({ mcpServers: {} }))
  })

  it('leaves a malformed file alone', () => {
    const dir = makeTempDir()
    const mcpPath = join(dir, 'mcp.json')
    writeFileSync(mcpPath, '{ broken', 'utf-8')
    assert.equal(removeAgentBrowserMcp({ mcpPath }), false)
    assert.equal(readFileSync(mcpPath, 'utf-8'), '{ broken')
  })
})

describe('panelMcpEntry', () => {
  const entry = (): Record<string, unknown> =>
    panelMcpEntry({
      nodeExecutable: 'C://app//VesPi.exe',
      serverPath: 'C://app//resources//resources//vespi-panel-mcp.mjs',
      pipePath: '\\\\.\\pipe\\vespi-panel-abc123',
      token: 'secret-token',
    })

  it('runs the panel server through the app executable as Node', () => {
    assert.equal(entry().command, 'C://app//VesPi.exe')
    assert.deepEqual(entry().args, ['C://app//resources//resources//vespi-panel-mcp.mjs'])
    assert.equal((entry().env as Record<string, string>).ELECTRON_RUN_AS_NODE, '1')
  })

  // The pipe path and token are the whole access control story.
  it('passes the pipe and token through the environment', () => {
    const env = entry().env as Record<string, string>
    assert.equal(env.VESPI_PANEL_PIPE, '\\\\.\\pipe\\vespi-panel-abc123')
    assert.equal(env.VESPI_PANEL_TOKEN, 'secret-token')
  })

  it('is a separate server from the agent browser, so both can coexist', () => {
    const merged = mergeMcpServerEntry(
      mergeMcpServerEntry(null, AGENT_BROWSER_MCP_NAME, baseEntry()),
      PANEL_MCP_NAME,
      entry()
    )
    const parsed = JSON.parse(merged)
    assert.deepEqual(Object.keys(parsed.mcpServers).sort(), ['browser', 'panel'])
  })

  it('can be removed again without touching the other server', () => {
    const dir = makeTempDir()
    const mcpPath = join(dir, 'mcp.json')
    writeFileSync(
      mcpPath,
      mergeMcpServerEntry(mergeMcpServerEntry(null, AGENT_BROWSER_MCP_NAME, baseEntry()), PANEL_MCP_NAME, entry()),
      'utf-8'
    )
    assert.equal(removeAgentBrowserMcp({ mcpPath, name: PANEL_MCP_NAME }), true)
    const parsed = JSON.parse(readFileSync(mcpPath, 'utf-8'))
    assert.deepEqual(Object.keys(parsed.mcpServers), [AGENT_BROWSER_MCP_NAME])
  })
})

describe('extraResourcePath', () => {
  // extraResources copies resources/ to resources/, so packaged is one level deeper.
  it('resolves under resources/ when packaged', () => {
    assert.equal(
      extraResourcePath('C://app//resources', true, 'C://app//resources//app.asar', 'vespi-panel-mcp.mjs'),
      join('C://app//resources', 'resources', 'vespi-panel-mcp.mjs')
    )
  })

  it('resolves against the project when unpackaged', () => {
    assert.equal(
      extraResourcePath('/res', false, 'C://dev//app', 'vespi-panel-mcp.mjs'),
      join('C://dev//app', 'resources', 'vespi-panel-mcp.mjs')
    )
  })
})
