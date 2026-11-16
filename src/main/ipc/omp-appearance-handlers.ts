import { readFile } from 'fs/promises'
import type { IpcMain } from 'electron'
import {
  DEFAULT_OMP_APPEARANCE,
  type OmpAppearance,
} from '../../shared/omp-appearance'
import { patchOmpProfileConfig, ompAgentConfigPath } from '../omp-profile-config'
import type { IpcContext } from './context'
import { parse } from 'yaml'
import { assertTrustedSender, isObject } from './validation'
import { assertTuiCanRestart, refreshTuiKeepingSession } from './model-handlers'

export function registerOmpAppearanceHandlers(ipcMain: IpcMain, ctx: IpcContext): void {
  ipcMain.handle('omp:appearance:get', async () => {
    try {
      const text = await readFile(ompAgentConfigPath(), 'utf-8')
      return parseAppearance(text)
    } catch {
      return { ...DEFAULT_OMP_APPEARANCE }
    }
  })

  ipcMain.handle('omp:appearance:set', async (event, appearance: Partial<OmpAppearance>) => {
    assertTrustedSender(event)
    if (!isObject(appearance)) throw new Error('OMP appearance must be an object')
    for (const field of ['themeDark', 'themeLight', 'symbolPreset', 'thinkingLevel'] as const) {
      if (appearance[field] !== undefined && (typeof appearance[field] !== 'string' || !appearance[field]?.trim())) {
        throw new Error(`Invalid OMP ${field}`)
      }
    }
    if (appearance.thinkingLevel && !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(appearance.thinkingLevel)) {
      throw new Error('Invalid OMP thinking level')
    }
    // Merge — never clobber modelRoles / thinking / setupVersion.
    assertTuiCanRestart(ctx)
    patchOmpProfileConfig({
      themeDark: appearance.themeDark,
      themeLight: appearance.themeLight,
      symbolPreset: appearance.symbolPreset,
      thinkingLevel: appearance.thinkingLevel,
    })
    // OMP TUI reads theme at spawn. Local TUI refresh only — keep the current
    // session (or its empty state), never jump to Home / create a new session.
    await refreshTuiKeepingSession(ctx, undefined, appearance.thinkingLevel)
    return { ok: true }
  })
}

function parseAppearance(text: string): OmpAppearance {
  const config = parse(text) as Record<string, unknown> | null
  const theme = isObject(config?.theme) ? config.theme : {}
  const dark = typeof theme.dark === 'string' ? theme.dark : undefined
  const light = typeof theme.light === 'string' ? theme.light : undefined
  const sym = typeof config?.symbolPreset === 'string' ? config.symbolPreset : undefined
  const think = typeof config?.defaultThinkingLevel === 'string' ? config.defaultThinkingLevel : undefined
  return {
    themeDark: dark ?? DEFAULT_OMP_APPEARANCE.themeDark,
    themeLight: light ?? DEFAULT_OMP_APPEARANCE.themeLight,
    symbolPreset: (sym as OmpAppearance['symbolPreset']) ?? DEFAULT_OMP_APPEARANCE.symbolPreset,
    thinkingLevel: (think as OmpAppearance['thinkingLevel']) ?? DEFAULT_OMP_APPEARANCE.thinkingLevel,
  }
}
