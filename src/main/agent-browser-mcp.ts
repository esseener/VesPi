import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

/**
 * Vendors Playwright's browser tools to the agent, so VesPi offers the same
 * semantic toolset as Claude Code / Codex: `browser_navigate`, `browser_snapshot`
 * (accessibility tree with element refs), `browser_click`, `browser_type`, …
 *
 * Everything the server needs ships inside the installer, and nothing is ever
 * fetched at the user's end:
 *
 * - **Runtime**: Electron already bundles Node, and the app's own executable
 *   doubles as it via `ELECTRON_RUN_AS_NODE=1`. No separate Node install.
 * - **Server code**: `@playwright/mcp` is a production dependency, unpacked from
 *   the asar (an external process cannot read inside `app.asar`).
 * - **Browser**: `--cdp-endpoint` points at the browser VesPi launches, which is
 *   the Chrome/Edge already on the machine. `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`
 *   makes a download impossible even if a code path tried, and
 *   `--executable-path` keeps a launch on that same installed browser.
 */
export const AGENT_BROWSER_MCP_NAME = 'browser'

/**
 * Name of the entry that exposes VesPi's *own* browser panel. Two browser
 * toolsets exist on purpose: `panel_*` drives the panel the user is watching,
 * `browser_*` drives the separate browser VesPi launched for the agent.
 */
export const PANEL_MCP_NAME = 'panel'

export interface BrowserMcpEntryOptions {
  /** The app executable, used as the Node runtime. */
  nodeExecutable: string
  /** Absolute path to `@playwright/mcp`'s cli.js, outside the asar. */
  cliPath: string
  /** Loopback CDP endpoint of the browser launched for the agent. */
  endpoint: string
  /** Installed browser, used only if a launch is ever needed. */
  executablePath?: string | null
}

export function browserMcpEntry(options: BrowserMcpEntryOptions): Record<string, unknown> {
  const args = [options.cliPath, `--cdp-endpoint=${options.endpoint}`]
  if (options.executablePath) args.push(`--executable-path=${options.executablePath}`)
  return {
    type: 'stdio',
    command: options.nodeExecutable,
    args,
    env: {
      // Electron's binary only behaves as a Node runtime when this is set.
      ELECTRON_RUN_AS_NODE: '1',
      // Belt and braces: even a misconfigured run must not fetch a browser.
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    },
    timeout: 120000,
  }
}

/** Where the unpacked copy of a bundled npm package lives at runtime. */
export function unpackedModulePath(resourcesPath: string, packaged: boolean, appPath: string, ...segments: string[]): string {
  const root = packaged ? join(resourcesPath, 'app.asar.unpacked', 'node_modules') : join(appPath, 'node_modules')
  return join(root, ...segments)
}

/** Where a file shipped through `extraResources` (`resources/` → `resources/`) lives. */
export function extraResourcePath(
  resourcesPath: string,
  packaged: boolean,
  appPath: string,
  ...segments: string[]
): string {
  const root = packaged ? join(resourcesPath, 'resources') : join(appPath, 'resources')
  return join(root, ...segments)
}

export interface PanelMcpEntryOptions {
  /** The app executable, used as the Node runtime. */
  nodeExecutable: string
  /** Absolute path to the panel MCP server, outside the asar. */
  serverPath: string
  /** Named pipe the active VesPi instance is listening on. */
  pipePath: string
  /** Per-launch token; the only thing standing between a stray local process and the panel. */
  token: string
}

/**
 * Entry for the panel server. The pipe path and token go into the child's
 * environment and nowhere else, so a local process that guesses the pipe name
 * still cannot drive the panel.
 */
export function panelMcpEntry(options: PanelMcpEntryOptions): Record<string, unknown> {
  return {
    type: 'stdio',
    command: options.nodeExecutable,
    args: [options.serverPath],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      VESPI_PANEL_PIPE: options.pipePath,
      VESPI_PANEL_TOKEN: options.token,
    },
    timeout: 120000,
  }
}

/**
 * Insert or replace one server entry, preserving everything else in the file —
 * other servers the user configured, and any top-level keys OMP may add.
 *
 * A malformed file is replaced wholesale rather than merged: the file is
 * machine-written, and refusing to fix it would silently disable the tools.
 */
export function mergeMcpServerEntry(existingText: string | null, name: string, entry: unknown): string {
  let record: Record<string, unknown> = {}
  if (existingText) {
    try {
      const parsed: unknown = JSON.parse(existingText)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        record = parsed as Record<string, unknown>
      }
    } catch {
      record = {}
    }
  }
  const servers = record.mcpServers
  const base: Record<string, unknown> =
    servers && typeof servers === 'object' && !Array.isArray(servers) ? { ...(servers as Record<string, unknown>) } : {}
  base[name] = entry
  return `${JSON.stringify({ ...record, mcpServers: base }, null, 2)}\n`
}

/**
 * Write the entry, best-effort. A failure here costs the agent its browser
 * tools, which is worth a log line but never worth blocking startup.
 */
export function ensureAgentBrowserMcp(options: {
  mcpPath: string
  entry: unknown
  name?: string
  readFile?: (path: string) => string
  pathExists?: (path: string) => boolean
}): boolean {
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf-8'))
  const pathExists = options.pathExists ?? existsSync
  try {
    const existing = pathExists(options.mcpPath) ? readFile(options.mcpPath) : null
    const next = mergeMcpServerEntry(existing, options.name ?? AGENT_BROWSER_MCP_NAME, options.entry)
    if (existing === next) return true
    mkdirSync(dirname(options.mcpPath), { recursive: true })
    writeFileSync(options.mcpPath, next, 'utf-8')
    return true
  } catch {
    return false
  }
}

/** Remove the entry again when the feature is off, so OMP stops spawning it. */
export function removeAgentBrowserMcp(options: {
  mcpPath: string
  name?: string
  readFile?: (path: string) => string
  pathExists?: (path: string) => boolean
}): boolean {
  const name = options.name ?? AGENT_BROWSER_MCP_NAME
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf-8'))
  const pathExists = options.pathExists ?? existsSync
  try {
    if (!pathExists(options.mcpPath)) return true
    const parsed: unknown = JSON.parse(readFile(options.mcpPath))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return true
    const record = parsed as Record<string, unknown>
    const servers = record.mcpServers
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return true
    if (!(name in (servers as Record<string, unknown>))) return true
    const rest: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(servers as Record<string, unknown>)) {
      if (key !== name) rest[key] = value
    }
    writeFileSync(options.mcpPath, `${JSON.stringify({ ...record, mcpServers: rest }, null, 2)}\n`, 'utf-8')
    return true
  } catch {
    // A malformed file belongs to the user; leave it alone.
    return false
  }
}
