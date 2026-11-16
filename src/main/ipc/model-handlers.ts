import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { assertTrustedSender, isString } from './validation'
import type { IpcContext } from './context'
import { patchOmpProfileConfig } from '../omp-profile-config'
import { runPiCli } from './run-pi-cli'
import { parseOmpModelCatalog } from '../omp-model-catalog'
import { loadAppSettings } from './settings'
import { terminalRuntimeOptions } from './terminal-runtime-options'

/**
 * Refresh the local TUI after a settings change without creating a new
 * session and without bouncing the shell to Home.
 */
export function assertTuiCanRestart(ctx: IpcContext): void {
  if (!ctx.terminalService.isRunning()) return
  const state = ctx.terminalService.getSessionState()
  if (!state) throw new Error('OMP session is not ready. Retry after startup completes.')
  if (state.busy) throw new Error('OMP is working. Apply terminal settings after the current turn finishes.')
}

async function refreshTuiKeepingSession(ctx: IpcContext, model?: string, thinkingLevel?: string): Promise<void> {
  if (!ctx.terminalService.isRunning()) return
  assertTuiCanRestart(ctx)
  const state = ctx.terminalService.getSessionState()!
  const resume = state.sessionPath
  const settings = await loadAppSettings(ctx.workspaceManager)
  const runtime = terminalRuntimeOptions(settings, ctx.terminalService.getCwd())
  // Restored sessions carry their own effort. Override it only when the user
  // explicitly changes effort; appearance changes preserve the live choice.
  const effort = thinkingLevel ?? state.thinkingLevel
  if (effort) runtime.args = [...runtime.args ?? [], '--thinking', effort]
  const result = await ctx.terminalService.restart({ ...runtime, resumeSessionPath: resume, continueSession: false, model: model ?? state.model ?? runtime.model })
  if (result) {
    ctx.broadcast(IPC_CHANNELS.EVENT_TERMINAL_RESTARTED, { resumed: Boolean(resume) })
  }
}

/**
 * Model / thinking level must land in TWO places:
 * 1. The live TUI (terminal) and/or the GUI rpc kernel.
 * 2. OMP profile config.yml so the next TUI spawn starts on the same model.
 */
export function registerModelHandlers(ctx: IpcContext): void {
  const { getActivePi, terminalService } = ctx

  function pokeTui(command: string): void {
    try {
      terminalService.write(command)
    } catch {
      /* terminal may be closed */
    }
  }

  function tryRpc(fn: () => Promise<unknown>): Promise<unknown> {
    try {
      return fn()
    } catch (err) {
      return Promise.resolve({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  ipcMain.handle(IPC_CHANNELS.MODEL_SET, async (event, provider: unknown, modelId: unknown) => {
    assertTrustedSender(event)
    if (!isString(provider)) throw new Error('provider must be a string')
    if (!isString(modelId)) throw new Error('modelId must be a string')
    assertTuiCanRestart(ctx)

    patchOmpProfileConfig({ defaultModel: `${provider}/${modelId}` })

    // Local TUI refresh: stay in chat, keep (or keep empty) session, no Home.
    await refreshTuiKeepingSession(ctx, `${provider}/${modelId}`)

    const pi = ctx.workspaceManager.getActivePiManager()
    if (pi?.getStatus().status === 'running') {
      return await pi.sendCommand({ type: 'set_model', provider, modelId })
    }
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_CYCLE, async () => {
    pokeTui('\x10')
    return tryRpc(() => getActivePi().sendCommand({ type: 'cycle_model' }))
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_LIST_AVAILABLE, async () => {
    const cwd = ctx.workspaceManager.getActiveWorkspace()?.path ?? process.cwd()
    const result = await runPiCli(['models', '--json'], cwd, 15000, 'omp')
    if (!result.success) throw new Error('Could not load the OMP model catalog')
    return { success: true, data: { models: parseOmpModelCatalog(result.stdout ?? result.output) } }
  })

  ipcMain.handle(IPC_CHANNELS.THINKING_SET_LEVEL, async (event, level: unknown) => {
    assertTrustedSender(event)
    if (!isString(level)) throw new Error('level must be a string')
    if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(level)) throw new Error('Invalid OMP thinking level')
    assertTuiCanRestart(ctx)

    patchOmpProfileConfig({ thinkingLevel: level })
    await refreshTuiKeepingSession(ctx, undefined, level)
    const pi = ctx.workspaceManager.getActivePiManager()
    if (pi?.getStatus().status === 'running') return pi.sendCommand({ type: 'set_thinking_level', level })
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.THINKING_CYCLE_LEVEL, async () => {
    return tryRpc(() => getActivePi().sendCommand({ type: 'cycle_thinking_level' }))
  })
}

export { refreshTuiKeepingSession }
