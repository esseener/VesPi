import { writeFileSync, renameSync } from 'node:fs'

interface Context {
  agent?: { kind: string }
  sessionManager: { getSessionFile(): string | undefined }
  model?: { provider: string; id: string }
  isIdle(): boolean
  setInterval(callback: () => void, ms: number): unknown
}

/** Report the owning TUI session, never another RPC process's session. */
export default function tuiState(api: {
  on(name: string, handler: (event: unknown, ctx: Context) => void): void
  getThinkingLevel(): string | undefined
}): void {
  const file = process.env.VESPI_TUI_STATE_FILE
  if (!file) return
  let completed = 0
  const publish = (event: unknown, ctx: Context): void => {
    if (ctx.agent?.kind === 'sub') return
    const type = (event as { type?: string })?.type
    if (type === 'agent_end') completed++
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify({
      pid: process.pid,
      sessionPath: ctx.sessionManager.getSessionFile() ?? null,
      model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
      thinkingLevel: api.getThinkingLevel() ?? null,
      busy: type === 'agent_start' ? true : type === 'agent_end' ? false : !ctx.isIdle(),
      completed,
    }))
    renameSync(temporary, file)
  }
  for (const event of ['session_start', 'session_switch', 'session_branch', 'session_clear', 'agent_start', 'agent_end']) {
    api.on(event, publish)
  }
  api.on('session_start', (_event, ctx) => {
    if (ctx.agent?.kind !== 'sub') ctx.setInterval(() => publish(null, ctx), 1000)
  })
}
