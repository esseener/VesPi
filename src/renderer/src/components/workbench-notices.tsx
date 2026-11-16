import { useAppStore, countPromptsWaitingElsewhere, formatPromptsWaiting } from '../store'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'

/** Only actionable exceptions need space outside the terminal's own status line. */
export function WorkbenchNotices(): React.JSX.Element | null {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const terminalError = useAppStore((state) => state.terminalOpen && state.terminalStatus === 'error')
  const pending = useAppStore((state) => countPromptsWaitingElsewhere(state.pendingPromptCounts, state.activeWorkspace?.id ?? null))
  const setCurrentView = useAppStore((state) => state.setCurrentView)

  if (!terminalError && pending === 0) return null

  return (
    <div role="status" className="flex shrink-0 flex-wrap items-center gap-x-4 border-t border-border bg-transparent px-3 text-xs">
      {terminalError && <button type="button" className="min-h-8 text-error underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus" onClick={() => setCurrentView('chat')}>
        {t(language, 'terminalConnectionError')}
      </button>}
      {pending > 0 && <span className="py-2 text-warning">{formatPromptsWaiting(pending, language)}</span>}
    </div>
  )
}
