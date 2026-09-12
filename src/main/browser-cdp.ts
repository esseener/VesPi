import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { delimiter, join } from 'path'
import { getLegacyGuiDataDirs } from './app-data-paths'

/**
 * Hands the agent's `browser` tool a browser the user can see.
 *
 * Why not the embedded panel: VesPi's panel is an Electron `<webview>`, whose
 * CDP target type is `webview`. The kernel's attach path only accepts `page`
 * targets (hard-coded in `pickElectronTarget`, verified in both OMP 18.1.17 and
 * 18.1.18), so the panel can never be the target. Instead we launch a real
 * Chromium-family browser with a debugging port and point the tool at it.
 *
 * The browser gets its **own user-data-dir**, so the agent's sessions and
 * logins stay separate from the user's personal profile. Pointing the port
 * setting at a browser the user already runs shares that one instead.
 */
export const DEFAULT_AGENT_BROWSER_PORT = 9223

/** Override the port without touching settings (tests, second profiles). */
export const AGENT_BROWSER_PORT_ENV = 'VESPI_AGENT_BROWSER_PORT'

/** Profile directory the agent's browser is launched with, under the GUI dir. */
export const AGENT_BROWSER_PROFILE_DIR = 'agent-browser-profile'

/** Generated into the GUI data dir once the endpoint is confirmed up. */
export const BROWSER_CDP_OVERLAY_FILE = 'omp-browser-cdp.yml'

/**
 * OMP reads this as a path-delimiter-separated list of config files merged on
 * top of the profile's own `config.yml` — it appends, never replaces.
 */
const CONFIG_FILES_ENV = 'PI_CONFIG_FILES'

const SETTINGS_FILE_NAME = 'settings.json'

export function resolveAgentBrowserPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[AGENT_BROWSER_PORT_ENV]?.trim()
  if (!raw) return DEFAULT_AGENT_BROWSER_PORT
  const parsed = Number(raw)
  // Fall back rather than throw: a malformed override must not stop startup.
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return DEFAULT_AGENT_BROWSER_PORT
  return parsed
}

/**
 * Enabled is the shipped default: the point is that every model gets a drivable
 * browser without the user configuring anything first. Only an explicit `false`
 * turns it off, and an unreadable value fails closed rather than launching a
 * browser with a debugging port nobody asked for.
 */
export function agentBrowserEnabledIn(parsedSettings: unknown): boolean {
  if (!parsedSettings || typeof parsedSettings !== 'object') return true
  const raw = (parsedSettings as { agentBrowserEnabled?: unknown }).agentBrowserEnabled
  if (raw === undefined) return true
  if (raw === false) return false
  if (raw === true) return true
  return false
}

/** Candidate settings.json paths, most authoritative first. */
export function agentBrowserSettingsCandidates(options: {
  guiDataDir: string
  appDataDir?: string
  homeDir?: string
}): string[] {
  const primary = join(options.guiDataDir, SETTINGS_FILE_NAME)
  const legacy = getLegacyGuiDataDirs({ appDataDir: options.appDataDir, homeDir: options.homeDir }).map(
    (dir) => join(dir, SETTINGS_FILE_NAME)
  )
  return [primary, ...legacy]
}

/** First readable settings file decides; a truncated one fails closed. */
export function readAgentBrowserEnabled(
  candidates: string[],
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf-8'),
  pathExists: (path: string) => boolean = existsSync
): boolean {
  for (const candidate of candidates) {
    if (!pathExists(candidate)) continue
    try {
      return agentBrowserEnabledIn(JSON.parse(readFile(candidate)))
    } catch {
      return false
    }
  }
  // No settings file at all is a fresh install, which ships with this on.
  return true
}

/**
 * Installed Chromium-family browsers, most preferred first. Edge is included
 * because it is Chromium and speaks the same CDP, and it is present on every
 * current Windows install.
 */
export function chromeExecutableCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const local = env.LOCALAPPDATA ?? ''
  const programFiles = env.ProgramFiles ?? ''
  const programFilesX86 = env['ProgramFiles(x86)'] ?? ''
  const roots = [local, programFiles, programFilesX86].filter(Boolean)
  const relatives: string[][] = [
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
    ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
    ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
    ['Chromium', 'Application', 'chrome.exe'],
  ]
  const candidates: string[] = []
  // Walk by browser first, not by root, so the preferred engine wins no matter
  // which install root happens to be checked first.
  for (const relative of relatives) {
    for (const root of roots) candidates.push(join(root, ...relative))
  }
  return candidates
}

export function pickChromeExecutable(
  candidates: string[],
  pathExists: (path: string) => boolean = existsSync
): string | null {
  for (const candidate of candidates) {
    if (pathExists(candidate)) return candidate
  }
  return null
}

/**
 * Launch arguments for the agent's browser.
 *
 * `about:blank` last keeps the window from restoring the previous session's
 * tabs, so the agent starts from a known empty page.
 */
export function agentBrowserLaunchArgs(port: number, profileDir: string): string[] {
  return [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    'about:blank',
  ]
}

export function browserCdpOverlayPath(guiDataDir: string): string {
  return join(guiDataDir, BROWSER_CDP_OVERLAY_FILE)
}

/** The overlay handed to OMP: only `cdpUrl`, so nothing else is touched. */
export function browserCdpOverlayYaml(port: number): string {
  return [
    '# Generated by VesPi. Points the OMP browser tool at the browser VesPi',
    '# launched for the agent. Rewritten on every launch; safe to delete.',
    'browser:',
    `  cdpUrl: "http://127.0.0.1:${port}"`,
    '',
  ].join('\n')
}

/**
 * Append the overlay to PI_CONFIG_FILES without dropping an existing value —
 * a user who already points OMP at their own overlays keeps them.
 */
export function withConfigFilesEnv(
  existing: string | undefined,
  overlayPath: string,
  separator: string = delimiter
): string {
  const parts = (existing ?? '')
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.includes(overlayPath)) parts.push(overlayPath)
  return parts.join(separator)
}

/** The PI_CONFIG_FILES value that points the kernel at the overlay. */
export function browserCdpConfigFilesValue(
  overlayPath: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  return withConfigFilesEnv(env[CONFIG_FILES_ENV], overlayPath, delimiter)
}

let kernelEnv: Record<string, string> = {}

/**
 * Env every kernel start needs so the browser tool attaches. Stays empty until
 * the endpoint answers, so the kernel is never pointed at a dead port.
 */
export function browserCdpKernelEnv(): Record<string, string> {
  return { ...kernelEnv }
}

/** Test seam: clear the module state between cases. */
export function resetBrowserCdpState(): void {
  kernelEnv = {}
}

export type AgentBrowserStatus = 'reused' | 'launched' | 'unavailable'

export interface AgentBrowserProbe {
  isUp: (port: number) => Promise<boolean>
  launch: (executable: string, args: string[]) => void
  pickExecutable: () => string | null
  /** How long to wait for a freshly launched browser to answer. */
  waitMs: number
  sleep: (ms: number) => Promise<void>
  now: () => number
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function isCdpUp(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    })
    return response.ok
  } catch {
    return false
  }
}

function launchDetached(executable: string, args: string[]): void {
  const child = spawn(executable, args, { detached: true, stdio: 'ignore' })
  child.unref()
}

/**
 * Reuse the browser on `port` if something already answers there, otherwise
 * launch one and wait for it to come up.
 *
 * "Unavailable" is a normal outcome, not an error: no Chromium-family browser
 * installed, or the launch failed. The caller then leaves the kernel alone.
 */
export async function ensureAgentBrowser(
  options: { port: number; profileDir: string; probe?: Partial<AgentBrowserProbe> }
): Promise<AgentBrowserStatus> {
  const probe = options.probe ?? {}
  const isUp = probe.isUp ?? isCdpUp
  const pickExecutable = probe.pickExecutable ?? (() => pickChromeExecutable(chromeExecutableCandidates()))
  const launch = probe.launch ?? launchDetached
  const sleep = probe.sleep ?? defaultSleep
  const waitMs = probe.waitMs ?? 8000
  const now = probe.now ?? (() => Date.now())

  if (await isUp(options.port)) return 'reused'

  const executable = pickExecutable()
  if (!executable) return 'unavailable'

  try {
    mkdirSync(options.profileDir, { recursive: true })
    launch(executable, agentBrowserLaunchArgs(options.port, options.profileDir))
  } catch {
    return 'unavailable'
  }

  const deadline = now() + waitMs
  while (now() < deadline) {
    await sleep(400)
    if (await isUp(options.port)) return 'launched'
  }
  return 'unavailable'
}

export interface AgentBrowserOptions {
  guiDataDir: string
  appDataDir?: string
  homeDir?: string
  env?: NodeJS.ProcessEnv
}

/**
 * Decide whether to hand the agent a browser. Called before `app.whenReady()`
 * so nothing about it depends on windows existing yet. Wiring the kernel is
 * deliberately not done here: it waits until the endpoint actually answers.
 */
export function initAgentBrowser(options: AgentBrowserOptions): { enabled: boolean; port: number | null } {
  const env = options.env ?? process.env
  const enabled = readAgentBrowserEnabled(
    agentBrowserSettingsCandidates({
      guiDataDir: options.guiDataDir,
      appDataDir: options.appDataDir,
      homeDir: options.homeDir,
    })
  )
  kernelEnv = {}
  if (!enabled) return { enabled: false, port: null }
  return { enabled: true, port: resolveAgentBrowserPort(env) }
}

/**
 * Bring the browser up, then publish the overlay and the env the kernel needs.
 * Called once at startup; later kernel starts read the module state.
 */
export async function startAgentBrowser(
  options: AgentBrowserOptions & {
    port: number
    probe?: Partial<AgentBrowserProbe>
    onStatus?: (status: AgentBrowserStatus, detail: { port: number; overlayPath: string }) => void
  }
): Promise<AgentBrowserStatus> {
  const env = options.env ?? process.env
  const profileDir = join(options.guiDataDir, AGENT_BROWSER_PROFILE_DIR)
  const overlayPath = browserCdpOverlayPath(options.guiDataDir)

  const status = await ensureAgentBrowser({ port: options.port, profileDir, probe: options.probe })

  if (status === 'unavailable') {
    kernelEnv = {}
    options.onStatus?.(status, { port: options.port, overlayPath })
    return status
  }

  try {
    mkdirSync(options.guiDataDir, { recursive: true })
    writeFileSync(overlayPath, browserCdpOverlayYaml(options.port), 'utf-8')
  } catch {
    // No overlay means no way to point the kernel; leave it alone.
    kernelEnv = {}
    options.onStatus?.('unavailable', { port: options.port, overlayPath })
    return 'unavailable'
  }

  kernelEnv = { [CONFIG_FILES_ENV]: browserCdpConfigFilesValue(overlayPath, env) }
  options.onStatus?.(status, { port: options.port, overlayPath })
  return status
}
