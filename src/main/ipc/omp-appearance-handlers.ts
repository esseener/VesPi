import { readFile } from 'fs/promises'
import type { IpcMain } from 'electron'
import {
  DEFAULT_OMP_APPEARANCE,
  type OmpAppearance,
} from '../../shared/omp-appearance'
import { patchOmpProfileConfig, ompAgentConfigPath } from '../omp-profile-config'
import type { IpcContext } from './context'

export function registerOmpAppearanceHandlers(ipcMain: IpcMain, ctx: IpcContext): void {
  const { terminalService } = ctx

  ipcMain.handle('omp:appearance:get', async () => {
    try {
      const text = await readFile(ompAgentConfigPath(), 'utf-8')
      return parseAppearance(text)
    } catch {
      return { ...DEFAULT_OMP_APPEARANCE }
    }
  })

  ipcMain.handle('omp:appearance:set', async (_e, appearance: OmpAppearance) => {
    // Merge — never clobber modelRoles / thinking / setupVersion.
    patchOmpProfileConfig({
      themeDark: appearance.themeDark,
      themeLight: appearance.themeLight,
      symbolPreset: appearance.symbolPreset,
      thinkingLevel: appearance.thinkingLevel,
    })
    // OMP TUI reads theme at spawn. Restart the PTY so the change is visible
    // immediately instead of requiring a manual terminal toggle.
    try {
      await terminalService.restart()
    } catch {
      /* terminal may not be running */
    }
    return { ok: true }
  })
}

function parseAppearance(text: string): OmpAppearance {
  const dark = /^\s*dark:\s*(\S+)/m.exec(text)?.[1]
  const light = /^\s*light:\s*(\S+)/m.exec(text)?.[1]
  const sym = /^\s*symbolPreset:\s*(\S+)/m.exec(text)?.[1]
  const think = /^\s*defaultLevel:\s*(\S+)/m.exec(text)?.[1]
  return {
    themeDark: dark ?? DEFAULT_OMP_APPEARANCE.themeDark,
    themeLight: light ?? DEFAULT_OMP_APPEARANCE.themeLight,
    symbolPreset: (sym as OmpAppearance['symbolPreset']) ?? DEFAULT_OMP_APPEARANCE.symbolPreset,
    thinkingLevel: (think as OmpAppearance['thinkingLevel']) ?? DEFAULT_OMP_APPEARANCE.thinkingLevel,
  }
}
