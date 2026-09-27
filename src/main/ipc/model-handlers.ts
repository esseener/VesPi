import { ipcMain } from 'electron'
import { readFileSync, existsSync } from 'fs'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { isString } from './validation'
import type { IpcContext } from './context'
import { patchOmpProfileConfig } from '../omp-profile-config'
import { modelsConfigPaths } from './models-config-handlers'
import { inspectSessionContent } from '../session-metadata'

/** Local models.json → model list, so the picker works without the rpc kernel. */
function listModelsFromConfig(): Array<{ provider: string; id: string; name?: string }> {
  const { file } = modelsConfigPaths()
  if (!existsSync(file)) return []
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as {
      providers?: Record<string, { models?: Array<{ id?: string; name?: string }> }>
    }
    const out: Array<{ provider: string; id: string; name?: string }> = []
    for (const [provider, cfg] of Object.entries(raw.providers ?? {})) {
      for (const m of cfg.models ?? []) {
        if (m?.id) out.push({ provider, id: m.id, name: m.name ?? m.id })
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * Refresh the local TUI after a settings change without creating a new
 * session and without bouncing the shell to Home.
 */
async function refreshTuiKeepingSession(ctx: IpcContext): Promise<void> {
  const active = ctx.workspaceManager.getActiveSessionRuntime()
  const path = active?.sessionPath ?? null
  // Only attach when the file has real content — empty/new tabs stay on the
  // OMP welcome input instead of a dead read-only transcript.
  let resume: string | null = null
  if (path && existsSync(path)) {
    const state = await inspectSessionContent(path)
    if (state !== 'empty') resume = path
  }
  try {
    await ctx.terminalService.restart({ resumeSessionPath: resume })
    ctx.broadcast(IPC_CHANNELS.EVENT_TERMINAL_RESTARTED, { resumed: Boolean(resume) })
  } catch {
    /* no live terminal */
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

  ipcMain.handle(IPC_CHANNELS.MODEL_SET, async (_event, provider: unknown, modelId: unknown) => {
    if (!isString(provider)) throw new Error('provider must be a string')
    if (!isString(modelId)) throw new Error('modelId must be a string')

    patchOmpProfileConfig({ defaultModel: `${provider}/${modelId}` })

    // Local TUI refresh: stay in chat, keep (or keep empty) session, no Home.
    await refreshTuiKeepingSession(ctx)

    const rpc = await tryRpc(() => getActivePi().sendCommand({ type: 'set_model', provider, modelId }))
    return rpc ?? { ok: true }
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_CYCLE, async () => {
    pokeTui('\x10')
    return tryRpc(() => getActivePi().sendCommand({ type: 'cycle_model' }))
  })

  ipcMain.handle(IPC_CHANNELS.MODEL_LIST_AVAILABLE, async () => {
    try {
      return await getActivePi().sendCommand({ type: 'get_available_models' })
    } catch {
      const models = listModelsFromConfig()
      return {
        success: true,
        data: {
          models: models.map((m) => ({
            id: m.id,
            name: m.name ?? m.id,
            provider: m.provider,
          })),
        },
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.THINKING_SET_LEVEL, async (_event, level: unknown) => {
    if (!isString(level)) throw new Error('level must be a string')

    patchOmpProfileConfig({ thinkingLevel: level })
    pokeTui(`/thinking ${level}\r`)

    return tryRpc(() => getActivePi().sendCommand({ type: 'set_thinking_level', level }))
  })

  ipcMain.handle(IPC_CHANNELS.THINKING_CYCLE_LEVEL, async () => {
    return tryRpc(() => getActivePi().sendCommand({ type: 'cycle_thinking_level' }))
  })
}

export { refreshTuiKeepingSession }
