import type { WorkspaceActivity, WorkspaceActivityMap } from '../../../shared/ipc-contracts'
import { DEFAULT_LANGUAGE, t, type AppLanguage } from '../../../shared/i18n'

/**
 * Pure helpers mapping the main-process workspace-activity map to sidebar
 * indicators. Needs-approval deliberately yields no dot: the existing warning
 * count badge already covers held prompts, and a second marker for the same
 * fact would double-signal.
 */

export interface ActivityIndicator {
  /** Semantic background class for the dot. */
  colorClass: string
  /** Pulse animation for in-flight work. */
  pulse: boolean
  /** Tooltip text. */
  label: string
}

export function workspaceActivityIndicator(
  activity: WorkspaceActivity | undefined,
  language: AppLanguage = DEFAULT_LANGUAGE,
): ActivityIndicator | null {
  switch (activity?.state) {
    case 'working':
      return { colorClass: 'bg-accent', pulse: true, label: t(language, 'activityWorking') }
    case 'completed':
      return { colorClass: 'bg-success', pulse: false, label: t(language, 'activityCompleted') }
    case 'failed':
      return { colorClass: 'bg-error', pulse: false, label: t(language, 'activityFailed') }
    default:
      return null
  }
}

/**
 * One aggregate indicator for the collapsed switcher header, covering every
 * workspace EXCEPT the active one (whose state is already on screen).
 * Priority: failed > completed > working.
 */
export function summarizeBackgroundActivity(
  map: WorkspaceActivityMap,
  activeWorkspaceId: string | null,
  language: AppLanguage = DEFAULT_LANGUAGE,
): ActivityIndicator | null {
  let best: ActivityIndicator | null = null
  let bestRank = -1
  const ranks = { failed: 3, completed: 2, working: 1 } as const

  for (const [workspaceId, activity] of Object.entries(map)) {
    if (workspaceId === activeWorkspaceId) continue
    const rank = activity.state in ranks ? ranks[activity.state as keyof typeof ranks] : 0
    if (rank > bestRank) {
      const indicator = workspaceActivityIndicator(activity, language)
      if (indicator) {
        best = { ...indicator, label: t(language, 'activityOtherWorkspace', { label: indicator.label }) }
        bestRank = rank
      }
    }
  }
  return best
}
