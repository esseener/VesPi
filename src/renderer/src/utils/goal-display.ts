import type { GoalInfo } from '../../../shared/ipc-contracts'
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

export type GoalAction = 'pause' | 'resume' | 'complete' | 'drop'

/**
 * Which buttons a goal should offer.
 *
 * The kernel owns the state machine; the shell only offers the transitions that
 * make sense from the current state, so a paused goal cannot be paused again and
 * a finished one cannot be resumed.
 */
export function goalActions(status: GoalStatus): GoalAction[] {
  switch (status) {
    case 'active':
      return ['pause', 'complete', 'drop']
    case 'paused':
    case 'budget-limited':
      return ['resume', 'drop']
    case 'complete':
    case 'dropped':
    default:
      return []
  }
}
