import { useAppStore } from '../store'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import { agentEngineLabel } from '../../../shared/agent-engine-label'
import { clsx } from 'clsx'

/**
 * Compact OMP activity strip — sits above the main terminal. Not a second
 * terminal: status only, never accepts shell input.
 */
export function OmpStatusStrip(): React.JSX.Element {
  const language = useAppStore(
    (state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE
  )
  const piStatus = useAppStore((state) => state.piStatus)
  const piEngine = useAppStore((state) => state.piEngine)
  const subagentProgress = useAppStore((state) => state.subagentProgress)
  const sessionStats = useAppStore((state) => state.sessionStats)
  const isStreaming = useAppStore((state) => state.isStreaming)

  const runningSubs = subagentProgress.filter(
    (p) => (p.status ?? 'running').toLowerCase() === 'running'
  ).length
  const ctx = sessionStats?.contextUsage
  const engineName = agentEngineLabel(piEngine === 'omp' ? 'omp' : 'pi') ?? 'OMP'
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

  return (
    <div
      data-omp-status-strip
      className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-1.5 font-jetbrains text-[11px] text-muted"
    >
      <span
        className={clsx(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          piStatus === 'running' ? 'bg-success' : piStatus === 'error' ? 'bg-error' : 'bg-dim'
        )}
      />
      <b className="font-semibold tracking-wide text-accent-fg">{engineName}</b>
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
  )
}
