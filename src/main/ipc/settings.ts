import { BrowserWindow, ipcMain } from 'electron'


import { setPiExecutableOverride } from '../pi-rpc-manager'
import { applyInteractionModesToAll } from './interaction-modes'
import { WorkspaceManager } from '../workspace-manager'
import { getGuiDataPath } from '../app-data-paths'
import type { AppSettings } from '../../shared/ipc-contracts'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { DEFAULT_SETTINGS } from '../../shared/default-settings'
import { applyRunOnStartup } from '../startup-launch'
import { setTrayEnabled } from '../tray-manager'

import { readFile, writeFile, mkdir, rename } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { assertTrustedSender, isObject } from './validation'
import { appLog } from '../app-log'
import type { IpcContext } from './context'
import { defaultOmpExecutablePath } from '../vespi-runtime'
import { VESPI_PRIVATE_OMP_REL } from '../../shared/vespi'
import { DEFAULT_LANGUAGE, isAppLanguage } from '../../shared/i18n'
import { patchOmpProfileConfig, readOmpProfileSettings } from '../omp-profile-config'
import { refreshTuiKeepingSession } from './model-handlers'

function withResolvedOmpPath(settings: AppSettings): AppSettings {
  const path = settings.piExecutablePath?.trim()
  const language = isAppLanguage(settings.language) ? settings.language : DEFAULT_LANGUAGE
  if (!path || path === 'omp' || path === VESPI_PRIVATE_OMP_REL || path === 'pi') {
    return { ...settings, piEngine: 'omp', piExecutablePath: defaultOmpExecutablePath(), language }
  }
  if (settings.piEngine !== 'omp') {
    return { ...settings, piEngine: 'omp', language }
  }
  return { ...settings, language }
}

// ─── App Settings Persistence ────────────────────────────────────────────────

const SETTINGS_FILE_NAME = 'settings.json'

/** Also consumed by the diagnostics report. */
export function getSettingsPath(): string {
  return getGuiDataPath(SETTINGS_FILE_NAME)
}

export async function loadAppSettings(workspaceManager: WorkspaceManager): Promise<AppSettings> {
  const native = readOmpProfileSettings()
  try {
    const settingsPath = getSettingsPath()
    if (existsSync(settingsPath)) {
      const data = await readFile(settingsPath, 'utf-8')
      const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(data) }
      if (merged.piEngine !== 'auto' && merged.piEngine !== 'pi' && merged.piEngine !== 'omp') {
        merged.piEngine = 'omp'
      }
      return withResolvedOmpPath({ ...merged, ...native })
    }
  } catch {
    // Fall through to defaults
  }


  return withResolvedOmpPath({
    ...DEFAULT_SETTINGS,
    ...native,
    defaultCwd: workspaceManager.getActiveWorkspace()?.path ?? (process.env.HOME ?? process.env.USERPROFILE ?? process.cwd()),
  })
}

let settingsWrite: Promise<void> = Promise.resolve()
export function saveAppSettings(settings: Partial<AppSettings>): Promise<void> {
  const next = settingsWrite.then(() => writeAppSettings(settings))
  settingsWrite = next.catch(() => undefined)
  return next
}

async function writeAppSettings(settings: Partial<AppSettings>): Promise<void> {
  const settingsPath = getSettingsPath()
  const dir = join(settingsPath, '..')

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true })
  }

  // Merge with existing
  let existing: AppSettings = { ...DEFAULT_SETTINGS }
  try {
    if (existsSync(settingsPath)) {
      const data = await readFile(settingsPath, 'utf-8')
      existing = { ...DEFAULT_SETTINGS, ...JSON.parse(data) }
    }
  } catch {
    // Use defaults
  }

  const merged = { ...existing, ...settings }
  try {
    await writeFile(`${settingsPath}.tmp`, JSON.stringify(merged, null, 2), 'utf-8')
    await rename(`${settingsPath}.tmp`, settingsPath)
  } catch (err) {
    // Still propagate to the caller (the Settings panel surfaces it); the log
    // keeps a trace for diagnostics in packaged builds.
    appLog.error('settings', 'Failed to save settings.json', err)
    throw err
  }
}

export function registerSettingsHandlers(ctx: IpcContext): void {
  const { workspaceManager } = ctx

  // ─── Settings ───────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, async () => {
    return loadAppSettings(workspaceManager)
  })

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE, async (event, settings: unknown) => {
    assertTrustedSender(event)
    if (!isObject(settings)) throw new Error('settings must be an object')
    const patch = settings as Partial<AppSettings>
    const nativeChange = ['showThinking', 'steeringMode', 'followUpMode', 'interruptMode', 'ompThinkingLevel', 'ompThemeDark', 'ompSymbolPreset', 'permissionMode'].some(key => key in patch)
    if (nativeChange && ctx.terminalService.isRunning()) {
      const state = ctx.terminalService.getSessionState()
      if (!state) throw new Error('OMP session is not ready. Retry after startup completes.')
      if (state.busy) throw new Error('OMP is working. Apply terminal settings after the current turn finishes.')
    }
    if (nativeChange) {
      patchOmpProfileConfig({
        ...(typeof patch.showThinking === 'boolean' ? { hideThinkingBlock: !patch.showThinking } : {}),
        steeringMode: patch.steeringMode,
        followUpMode: patch.followUpMode,
        interruptMode: patch.interruptMode,
        thinkingLevel: patch.ompThinkingLevel,
        themeDark: patch.ompThemeDark,
        symbolPreset: patch.ompSymbolPreset,
      })
    }
    await saveAppSettings(settings as Partial<AppSettings>)
    // Reflect a "run on startup" change to the OS immediately (login item on
    // macOS/Windows, autostart entry on Linux). Only applied when the field is
    // part of this save to avoid redundant OS writes.
    if ('runOnStartup' in settings) {
      await applyRunOnStartup(Boolean((settings as Partial<AppSettings>).runOnStartup))
    }
    // Reflect a "minimize to tray" change immediately: create/destroy the tray
    // icon so the close behavior matches the new setting without a restart.
    if ('minimizeToTrayOnClose' in settings) {
      setTrayEnabled(Boolean((settings as Partial<AppSettings>).minimizeToTrayOnClose))
    }
    const updated = await loadAppSettings(workspaceManager)
    if (nativeChange) await refreshTuiKeepingSession(ctx, undefined, patch.ompThinkingLevel)
    if ('piExecutablePath' in settings || 'piEngine' in settings) {
      setPiExecutableOverride(updated.piExecutablePath, updated.piEngine)
    }
    if ('language' in settings) {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('menu:language-changed', updated.language)
      }
    }
    // The interaction modes live on the kernel as session state, so a change has
    // to be pushed at every live session — otherwise it would only take effect
    // for whichever tab happens to be in front. New sessions get them on start
    // (see interaction-modes.ts); this covers the ones already running.
    if ('steeringMode' in settings || 'followUpMode' in settings || 'interruptMode' in settings) {
      applyInteractionModesToAll(workspaceManager.getAllPiManagers(), updated)
    }
    return updated

  })

  // Reconcile the OS-level "run on startup" state with the saved preference on
  // launch. Self-healing: repairs a stale Linux autostart Exec path after an
  // app update/move and re-asserts the login item on macOS/Windows. Runs in the
  // background so a failure never blocks handler registration.
  void loadAppSettings(workspaceManager)
    .then((settings) => applyRunOnStartup(settings.runOnStartup))
    .catch((err) => console.error('[startup] Failed to reconcile run-on-startup:', err))
}
