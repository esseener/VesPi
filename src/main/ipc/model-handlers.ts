import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { isString } from './validation'
import type { IpcContext } from './context'
import { patchOmpProfileConfig } from '../omp-profile-config'

/**
 * Model / thinking level must land in TWO places:
 * 1. The live kernel (RPC when GUI chat is driving, TUI when the terminal is).
 * 2. OMP profile config.yml so the next TUI spawn starts on the same model.
 */
export function registerModelHandlers(ctx: IpcContext): void {
  const { getActivePi, terminalService } = ctx

  /** Best-effort: poke the live OMP TUI. Failures are fine — config still holds. */
  function pokeTui(command: string): void {
    try {
      terminalService.write(command)
    } catch {
      /* terminal may be closed */
    }
  }

  // ─── Model Management ───────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.MODEL_SET, async (_event, provider: unknown, modelId: unknown) => {
    if (!isString(provider)) throw new Error('provider must be a string')
    if (!isString(modelId)) throw new Error('modelId must be a string')

    // Persist for the next OMP spawn (modelRoles.default is "provider/id").
    patchOmpProfileConfig({ defaultModel: `${provider}/${modelId}` })

    // Drive the live TUI so the running session switches immediately.
    pokeTui(`/model ${modelId}\r`)

    return getActivePi().sendCommand({ type: 'set_model', provider, modelId })
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_CYCLE, async () => {
    pokeTui('\x10') // Ctrl+P — OMP's model cycle
    return getActivePi().sendCommand({ type: 'cycle_model' })
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_LIST_AVAILABLE, async () => {
    return getActivePi().sendCommand({ type: 'get_available_models' })
  })

  ipcMain.handle(IPC_CHANNELS.THINKING_SET_LEVEL, async (_event, level: unknown) => {
    if (!isString(level)) throw new Error('level must be a string')

    patchOmpProfileConfig({ thinkingLevel: level })
    pokeTui(`/thinking ${level}\r`)

    return getActivePi().sendCommand({ type: 'set_thinking_level', level })
  })

  ipcMain.handle(IPC_CHANNELS.THINKING_CYCLE_LEVEL, async () => {
    return getActivePi().sendCommand({ type: 'cycle_thinking_level' })
  })
}
