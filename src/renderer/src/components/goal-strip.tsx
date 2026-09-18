import { Target } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_LANGUAGE, t, type MessageKey } from '../../../shared/i18n'
import { useAppStore } from '../store'
import {
  formatGoalTime,
  formatTokenCount,
  goalActions,
  goalStatusKey,
  type GoalAction,
} from '../utils/goal-display'

const ACTION_LABEL_KEY: Record<GoalAction, MessageKey> = {
  resume: 'goalResume',
  complete: 'goalCompleteAction',
  drop: 'goalDrop',
}

/**
 * How long a click waits for the kernel to confirm before the buttons unlock
 * again. Confirmation arrives as a `goal_updated` status change (or the strip
 * unmounting when the goal ends); if the model never calls the tool the
 * buttons must not stay dead forever.
 */
const PENDING_TIMEOUT_MS = 30_000

/**
 * The active goal, mirrored from the kernel's `goal_updated` events.
 *
 * Goal mode is kernel-owned: the objective, its state machine, the token budget
 * and the continuation between turns all live in OMP. The shell cannot call the
 * goal tool itself (the kernel exposes no RPC for it), so the buttons here ask
 * the model to call the tool — which is exactly what the tooltip says. Without
 * this strip an active goal is invisible: the agent keeps working between turns
 * and nothing on screen says what it is working toward or what it has spent.
 */
export function GoalStrip(): React.JSX.Element | null {
  const language = useAppStore((s) => s.settingsDraft.language ?? s.settings?.language ?? DEFAULT_LANGUAGE)
  const goalState = useAppStore((s) => s.goalState)
  const isStreaming = useAppStore((s) => s.isStreaming)
  const sendPrompt = useAppStore((s) => s.sendPrompt)
  const sendFollowUp = useAppStore((s) => s.sendFollowUp)
  const goal = goalState?.goal
  const [pending, setPending] = useState<GoalAction | null>(null)
  const statusAtClickRef = useRef<string | null>(null)

  // The click's only confirmation is the goal's status actually moving (or the
  // strip unmounting once the store normalizes a terminal goal away). Token and
  // time ticks also ride `goal_updated` but leave the status alone, so they
  // must not unlock the buttons early.
  useEffect(() => {
    if (!pending) return
    if ((goal?.status ?? null) !== statusAtClickRef.current) setPending(null)
  }, [pending, goal?.status])

  // Safety valve: if the model never calls the tool, the buttons unlock again
  // instead of staying locked until some future goal event.
  useEffect(() => {
    if (!pending) return
    const timer = window.setTimeout(() => setPending(null), PENDING_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [pending])

  if (!goal) return null

  const request = (action: GoalAction) => {
    if (pending) return
    statusAtClickRef.current = goal.status
    setPending(action)
    const message = t(language, 'goalToolRequest', { op: action })
    // Mid-turn clicks must not evaporate: sendPrompt silently drops while a
    // turn streams, and with goal auto-continuation a turn is usually in
    // flight. The follow-up queue is delivered right after the turn yields.
    if (isStreaming) void sendFollowUp(message)
    else void sendPrompt(message)
  }

  return (
    <div className="pointer-events-auto mx-auto mb-2 w-full max-w-5xl px-4">
      <div className="flex items-center gap-2.5 border border-border bg-surface/60 px-3 py-1.5 text-xs">
        <Target size={13} className="shrink-0 text-accent-fg" aria-hidden="true" />
        <span className="shrink-0 border border-border px-1.5 text-[10px] text-muted">
          {t(language, goalStatusKey(goal.status))}
        </span>
        <span className="min-w-0 flex-1 truncate text-primary" title={goal.objective}>
          {goal.objective}
        </span>
        <span className="shrink-0 text-dim">
          {t(language, 'goalProgress', {
            tokens: formatTokenCount(goal.tokensUsed),
            time: formatGoalTime(goal.timeUsedSeconds),
          })}
        </span>
        {pending && (
          <span className="shrink-0 text-[10px] text-dim">{t(language, 'goalPending')}</span>
        )}
        {goalActions(goal.status).map((action) => (
          <button
            key={action}
            type="button"
            title={t(language, 'goalActionHint')}
            disabled={pending !== null}
            onClick={() => request(action)}
            className="titlebar-no-drag shrink-0 border border-border-strong px-2 py-0.5 text-muted transition-colors hover:border-accent-fg hover:text-primary disabled:pointer-events-none disabled:opacity-40"
          >
            {t(language, ACTION_LABEL_KEY[action])}
          </button>
        ))}
      </div>
    </div>
  )
}
