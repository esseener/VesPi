import { existsSync, readFileSync } from 'node:fs'

import { agentBrowserSettingsCandidates } from './browser-cdp'
import { extraResourcePath } from './agent-browser-mcp'

/**
 * Wiring for the `computer` MCP server — the desktop-control counterpart of the
 * `browser` and `panel` entries.
 *
 * Why a third toolset instead of folding desktop control into the browser one:
 * they are genuinely different capabilities with different risk. `browser_*`
 * drives a browser VesPi launched; `panel_*` drives a page in VesPi's own window;
 * `computer_*` can click anything on the user's desktop. Keeping them as separate
 * servers is what lets the shell enable, allow-list and explain them separately.
 */

export const COMPUTER_MCP_NAME = 'computer'

/** Settings key: may the agent drive the desktop at all? */
export const COMPUTER_ENABLED_KEY = 'agentComputerEnabled'

/** Settings key: the process names the agent may drive. Empty means all. */
export const COMPUTER_APPS_KEY = 'agentComputerApps'

export interface ComputerMcpEntryOptions {
  /** The app executable, used as the Node runtime for the MCP bridge. */
  nodeExecutable: string
  /** Absolute path to the bridge script, outside the asar. */
  serverPath: string
  /** Named pipe this VesPi instance is listening on. */
  pipePath: string
  /** Per-launch token; the only thing between a local process and the desktop. */
  token: string
}

/**
 * Entry for the bridge. The pipe path and token travel in the child's environment
 * and nowhere else.
 */
export function computerMcpEntry(options: ComputerMcpEntryOptions): Record<string, unknown> {
  return {
    type: 'stdio',
    command: options.nodeExecutable,
    args: [options.serverPath],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      VESPI_COMPUTER_PIPE: options.pipePath,
      VESPI_COMPUTER_TOKEN: options.token,
    },
    timeout: 120000,
  }
}

/** Where the sidecar lands in a packaged build (`resources/resources/`). */
export function computerSidecarPath(resourcesPath: string, packaged: boolean, appPath: string): string {
  return extraResourcePath(resourcesPath, packaged, appPath, 'vespi-cua.exe')
}

/** Where the MCP bridge script lands in a packaged build. */
export function computerBridgePath(resourcesPath: string, packaged: boolean, appPath: string): string {
  return extraResourcePath(resourcesPath, packaged, appPath, 'vespi-computer-mcp.mjs')
}

/**
 * Desktop control is **off unless asked for**, the opposite of the agent browser.
 *
 * The browser is a sandbox VesPi owns: a fresh profile, no logins, only http(s).
 * The desktop is the user's actual machine — their mail, their files, their
 * banking tab. Enabling that by default would be a decision made on their behalf
 * that they cannot see, so anything other than an explicit `true` reads as off.
 */
export function agentComputerEnabledIn(parsedSettings: unknown): boolean {
  if (!parsedSettings || typeof parsedSettings !== 'object') return false
  const raw = (parsedSettings as Record<string, unknown>)[COMPUTER_ENABLED_KEY]
  return raw === true
}

/**
 * The allow-list, normalised. An empty result means "no list configured", which
 * the op layer treats as unrestricted — the feature being on is the authorisation.
 */
export function agentComputerAppsIn(parsedSettings: unknown): string[] {
  if (!parsedSettings || typeof parsedSettings !== 'object') return []
  const raw = (parsedSettings as Record<string, unknown>)[COMPUTER_APPS_KEY]
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export interface ComputerSettings {
  enabled: boolean
  allowedApps: string[]
}

/**
 * First readable settings file decides, and a truncated one fails closed — the
 * same rule the browser switch follows, in the direction that suits each feature.
 */
export function readComputerSettings(
  candidates: string[],
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf-8'),
  pathExists: (path: string) => boolean = existsSync
): ComputerSettings {
  for (const candidate of candidates) {
    if (!pathExists(candidate)) continue
    try {
      const parsed: unknown = JSON.parse(readFile(candidate))
      return {
        enabled: agentComputerEnabledIn(parsed),
        allowedApps: agentComputerAppsIn(parsed),
      }
    } catch {
      return { enabled: false, allowedApps: [] }
    }
  }
  return { enabled: false, allowedApps: [] }
}

/** Settings file paths, most authoritative first. Shared with the browser switch. */
export function computerSettingsCandidates(options: {
  guiDataDir: string
  appDataDir?: string
  homeDir?: string
}): string[] {
  return agentBrowserSettingsCandidates(options)
}
