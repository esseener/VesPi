import { Target } from 'lucide-react'
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
  pause: 'goalPause',
  resume: 'goalResume',
  complete: 'goalCompleteAction',
  drop: 'goalDrop',
}

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
  const sendPrompt = useAppStore((s) => s.sendPrompt)
  const goal = goalState?.goal
  if (!goal) return null

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
        {goalActions(goal.status).map((action) => (
          <button
            key={action}
            type="button"
            title={t(language, 'goalActionHint')}
            onClick={() => void sendPrompt(t(language, 'goalToolRequest', { op: action }))}
            className="titlebar-no-drag shrink-0 border border-border-strong px-2 py-0.5 text-muted transition-colors hover:border-accent-fg hover:text-primary"
          >
            {t(language, ACTION_LABEL_KEY[action])}
          </button>
        ))}
      </div>
    </div>
  )
}
