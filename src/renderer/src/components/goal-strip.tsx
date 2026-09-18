import { Target } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_LANGUAGE, t, type MessageKey } from '../../../shared/i18n'
import type { GoalControlFailure } from '../../../shared/vespi'
import { useAppStore } from '../store'
import {
  formatGoalTime,
  formatTokenCount,
  goalActions,
  goalControlFailureKey,
  goalStatusKey,
  type GoalAction,
} from '../utils/goal-display'

const ACTION_LABEL_KEY: Record<GoalAction, MessageKey> = {
  resume: 'goalResume',
  complete: 'goalCompleteAction',
  drop: 'goalDrop',
}

/**
 * How long a dispatched click waits for the goal to actually move before telling
 * the user the model has not reacted. The kernel round-trip is fast (the command
 * runs inside the kernel and steers the instruction at the model), so anything
 * beyond this means the model ignored it — which the user must be able to see
 * instead of watching a dead button.
 */
const SLOW_AFTER_MS = 20_000

/**
 * The active goal, mirrored from the kernel's `goal_updated` events.
 *
 * Goal mode is kernel-owned: the objective, its state machine, the token budget
 * and the continuation between turns all live in OMP. Nothing on the shell's side
 * can reach the goal state machine — the RPC table has no goal verb and the
 * extension API has none either — so a click dispatches the kernel's
 * `/vespi-goal` extension command, which steers a hidden instruction at the
 * model from inside the kernel. That means a click is a request, not a
 * guaranteed transition: the strip reports what it dispatched and says so when
 * the goal never moves.
 *
 * Without this strip an active goal is invisible: the agent keeps working between
 * turns and nothing on screen says what it is working toward or what it spent.
 */
export function GoalStrip(): React.JSX.Element | null {
  const language = useAppStore((s) => s.settingsDraft.language ?? s.settings?.language ?? DEFAULT_LANGUAGE)
  const goalState = useAppStore((s) => s.goalState)
  const goalControl = useAppStore((s) => s.goalControl)
  const goal = goalState?.goal
  const [pending, setPending] = useState<GoalAction | null>(null)
  const [failure, setFailure] = useState<GoalControlFailure | null>(null)
  const [slow, setSlow] = useState(false)
  const statusAtClickRef = useRef<string | null>(null)

  // The click's only real confirmation is the goal's status actually moving (or
  // the strip unmounting once the store normalizes a terminal goal away). Token
  // and time ticks also ride `goal_updated` but leave the status alone, so they
  // must not unlock the buttons early.
  useEffect(() => {
    if (!pending) return
    if ((goal?.status ?? null) !== statusAtClickRef.current) {
      setPending(null)
      setSlow(false)
    }
  }, [pending, goal?.status])

  // The instruction is steered, not queued, so it reaches the model on its next
  // step. If the status still has not moved, the model chose not to call the tool
  // — leave the buttons usable and say what happened.
  useEffect(() => {
    if (!pending) return
    const timer = window.setTimeout(() => {
      setPending(null)
      setSlow(true)
    }, SLOW_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [pending])

  if (!goal) return null

  const request = async (action: GoalAction) => {
    if (pending) return
    statusAtClickRef.current = goal.status
    setFailure(null)
    setSlow(false)
    setPending(action)
    const result = await goalControl(action)
    if (!result.ok) {
      // Nothing was dispatched, so waiting for a status flip would wait forever.
      setPending(null)
      setFailure(result.reason ?? 'dispatch-failed')
    }
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
        {pending && <span className="shrink-0 text-[10px] text-dim">{t(language, 'goalPending')}</span>}
        {!pending && slow && (
          <span className="shrink-0 text-[10px] text-warning">{t(language, 'goalPendingSlow')}</span>
        )}
        {!pending && failure && (
          <span className="shrink-0 text-[10px] text-error">
            {t(language, goalControlFailureKey(failure))}
          </span>
        )}
        {goalActions(goal.status).map((action) => (
          <button
            key={action}
            type="button"
            title={t(language, 'goalActionHint')}
            disabled={pending !== null}
            onClick={() => void request(action)}
            className="titlebar-no-drag shrink-0 border border-border-strong px-2 py-0.5 text-muted transition-colors hover:border-accent-fg hover:text-primary disabled:pointer-events-none disabled:opacity-40"
          >
            {t(language, ACTION_LABEL_KEY[action])}
          </button>
        ))}
      </div>
    </div>
  )
}
