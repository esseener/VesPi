import { useAppStore } from '../store'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import { agentEngineLabel } from '../../../shared/agent-engine-label'
import { localizeToolName } from '../tool-status-i18n'
import { clsx } from 'clsx'
import { useMemo } from 'react'

/**
 * OMP 执行状态流（只读）。主区唯一「终端感」表面，**不接受输入**。
 * 唯一输入口是底部助手命令条（ChatInput）。
 */
export function OmpActivityStream(): React.JSX.Element {
  const language = useAppStore(
    (state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE
  )
  const piStatus = useAppStore((state) => state.piStatus)
  const piEngine = useAppStore((state) => state.piEngine)
  const isStreaming = useAppStore((state) => state.isStreaming)
  const streamingToolCalls = useAppStore((state) => state.streamingToolCalls)
  const subagentProgress = useAppStore((state) => state.subagentProgress)
  const sessionStats = useAppStore((state) => state.sessionStats)
  const messages = useAppStore((state) => state.messages)

  const engineName = agentEngineLabel(piEngine === 'omp' ? 'omp' : 'pi') ?? 'OMP'
  const runningSubs = subagentProgress.filter(
    (p) => (p.status ?? 'running').toLowerCase() === 'running'
  ).length
  const ctx = sessionStats?.contextUsage

  const statusKey =
    piStatus === 'running'
      ? isStreaming
        ? 'statusStream'
        : 'statusReady'
      : piStatus === 'starting'
        ? 'statusStarting'
        : piStatus === 'error'
          ? 'statusError'
          : 'statusStopped'

  // Lightweight activity lines: recent tools + a summary header. Full prose
  // stays in the chat view (toggle via status bar) so this surface stays scannable.
  const toolLines = useMemo(() => {
    return [...streamingToolCalls.entries()].slice(-12).map(([id, tc]) => ({
      id,
      name: localizeToolName(language, tc.name),
      raw: tc.name,
      running: tc.isExecuting,
    }))
  }, [streamingToolCalls, language])

  const lastUser = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i]
    }
    return null
  }, [messages])

  return (
    <div
      data-omp-status-stream
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#020304]"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-1.5 font-jetbrains text-[11px] text-muted">
        <span
          className={clsx(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            piStatus === 'running' ? 'bg-success' : piStatus === 'error' ? 'bg-error' : 'bg-dim'
          )}
        />
        <b className="font-semibold tracking-wide text-accent-fg">{t(language, 'ompActivityTitle')}</b>
        <span className="text-ghost">|</span>
        <b className="text-accent-fg">{engineName}</b>
        <span className="text-ghost">|</span>
        <span>{t(language, statusKey)}</span>
        {runningSubs > 0 && (
          <>
            <span className="text-ghost">|</span>
            <span className="text-secondary">
              {t(language, 'subagentRunning', { count: String(runningSubs) })}
            </span>
          </>
        )}
        {ctx?.tokens != null && (
          <>
            <span className="text-ghost">|</span>
            <span>
              {t(language, 'statusContextTokens', {
                used: String(ctx.tokens),
                total: String(ctx.contextWindow),
              })}
            </span>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 font-jetbrains text-[12.5px] leading-[1.75] text-secondary">
        <div className="text-dim">{t(language, 'ompActivityHint')}</div>
        {lastUser && (
          <div className="mt-3 text-primary">
            <span className="text-accent-fg">›</span>{' '}
            <span className="line-clamp-2">{lastUser.content.slice(0, 160)}</span>
          </div>
        )}
        <div className="mt-3 space-y-1">
          {toolLines.length === 0 && !isStreaming && (
            <div className="text-dim">{t(language, 'ompActivityIdle')}</div>
          )}
          {toolLines.map((line) => (
            <div key={line.id} className="flex gap-2">
              <span className={line.running ? 'text-accent-fg' : 'text-success'}>
                {line.running ? '▸' : '✓'}
              </span>
              <span className="text-primary">{line.name}</span>
              <span className="text-dim">{line.raw}</span>
            </div>
          ))}
          {isStreaming && (
            <div className="text-accent-fg">● {t(language, 'statusStream')}</div>
          )}
        </div>
        <div className="mt-6 border-t border-dashed border-border pt-3 text-dim">
          {t(language, 'ompActivityFooter')}
        </div>
      </div>
    </div>
  )
}
