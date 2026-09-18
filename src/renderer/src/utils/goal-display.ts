import type { GoalInfo, GoalModeState } from '../../../shared/ipc-contracts'
import type { MessageKey } from '../../../shared/i18n'

/** Compact token count: 16920 → "16.9k", 940 → "940". */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0'
  if (tokens < 1000) return String(Math.round(tokens))
  const thousands = tokens / 1000
  return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1)}k`
}

/** Compact elapsed time from seconds: 9 → "9s", 125 → "2m 5s", 3720 → "1h 2m". */
export function formatGoalTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s'
  const total = Math.round(seconds)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) {
    const rest = total % 60
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
  }
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`
}

export type GoalStatus = GoalInfo['status']

/** i18n key for a goal's status. */
export function goalStatusKey(status: GoalStatus): MessageKey {
  switch (status) {
    case 'paused':
      return 'goalStatusPaused'
    case 'budget-limited':
      return 'goalStatusBudgetLimited'
    case 'complete':
      return 'goalStatusComplete'
    case 'dropped':
      return 'goalStatusDropped'
    case 'active':
    default:
      return 'goalStatusActive'
  }
}

export type GoalAction = 'resume' | 'complete' | 'drop'

/**
 * Which buttons a goal should offer.
 *
 * The kernel owns the state machine; the shell only offers the transitions that
 * make sense from the current state, and only the ones the kernel's `goal` tool
 * actually accepts. Measured on 18.2.5, the tool's op union is
 * `create | get | complete | resume | drop` — there is no `pause`, so a pause
 * button could never work and is not offered.
 */
export function goalActions(status: GoalStatus): GoalAction[] {
  switch (status) {
    case 'active':
      return ['complete', 'drop']
    case 'paused':
    case 'budget-limited':
      return ['resume', 'drop']
    case 'complete':
    case 'dropped':
    default:
      return []
  }
}

/**
 * Terminal goals are normalized away because the kernel never clears them: the
 * drop/complete path emits one final `goal_updated` that still carries the
 * finished goal object (with `enabled: false`) and never follows up with a
 * null state. The strip is for LIVE goals — showing a dead one forever reads
 * as "my click did nothing".
 */
export function normalizeGoalState(state: GoalModeState | null | undefined): GoalModeState | null {
  if (!state?.goal) return null
  const status: GoalInfo['status'] = state.goal.status
  if (status === 'dropped' || status === 'complete') return null
  return state
}
