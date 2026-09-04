import { useState, useEffect } from 'react'
import { useAppStore, countPromptsWaitingElsewhere, formatPromptsWaiting } from '../store'
import { clsx } from 'clsx'
import {
  PanelLeft,
  PanelLeftClose,
  Terminal,
  DollarSign,
  Layers,
  Minimize2,
  Loader2,
  GitBranch,
  Workflow as WorkflowIcon,
} from 'lucide-react'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'

export function StatusBar(): React.JSX.Element {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)

  const piStatus = useAppStore((state) => state.piStatus)
  const sessionStats = useAppStore((state) => state.sessionStats)
  const isStreaming = useAppStore((state) => state.isStreaming)
  const hasChatMessages = useAppStore((state) => state.messages.length > 0 || state.isStreaming)
  const pendingSteering = useAppStore((state) => state.pendingSteering)
  const pendingFollowUp = useAppStore((state) => state.pendingFollowUp)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const toggleTerminal = useAppStore((state) => state.toggleTerminal)
  const terminalOpen = useAppStore((state) => state.terminalOpen)
  const compactContext = useAppStore((state) => state.compactContext)
  const isCompacting = useAppStore((state) => state.sessionState?.isCompacting ?? false)
  const activeWorkspace = useAppStore((state) => state.activeWorkspace)
  const pendingPromptCounts = useAppStore((state) => state.pendingPromptCounts)
  const workflowPanelOpen = useAppStore((state) => state.workflowPanelOpen)
  const workflowRuns = useAppStore((state) => state.workflowRuns)
  const activeWorkflowCount = workflowRuns.filter(
    (run) =>
      (!activeWorkspace || run.workspaceId === activeWorkspace.id) &&
      (run.status === 'running' || run.status === 'paused')
  ).length

  // Blocking prompts held for OTHER workspaces (any extension's select/
  // confirm/input/editor) — the active workspace's prompt is already on screen.
  const promptsWaitingElsewhere = countPromptsWaitingElsewhere(
    pendingPromptCounts,
    activeWorkspace?.id ?? null
  )

  // Current git branch of the active workspace. Refreshed when the workspace
  // changes and when the window regains focus (branch switches outside the app).
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      window.piDesktop.files
        .getGitBranch()
        .then((b) => {
          if (!cancelled) setGitBranch(b)
        })
        .catch(() => {
          if (!cancelled) setGitBranch(null)
        })
    }
    load()
    const onFocus = (): void => load()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [activeWorkspace?.id])

  return (
    <div className="flex h-6 items-center justify-between border-t border-border bg-transparent px-2 font-jetbrains text-[11px]">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div
            className={clsx(
              'h-1.5 w-1.5 rounded-full',
              piStatus === 'running' && 'run-silver',
              piStatus === 'starting' && 'run-silver',
              piStatus === 'error' && 'bg-error',
              piStatus === 'stopped' && 'bg-elevated'
            )}
          />
          <span className="text-dim">
            {piStatus === 'running' ? t(language, 'statusReady')
              : piStatus === 'starting' ? t(language, 'statusStarting')
              : piStatus === 'stopped' ? t(language, 'statusStopped')
              : piStatus === 'error' ? t(language, 'statusError')
              : piStatus}
          </span>
        </div>

        {gitBranch && (
          <div className="flex items-center gap-1 text-dim" title={t(language, 'statusGitBranch', { branch: gitBranch })}>
            <GitBranch size={11} />
            <span>{gitBranch}</span>
          </div>
        )}

        {isStreaming && (
          <div className="flex items-center gap-1 text-secondary">
            <span className="run-silver h-2 w-2 rounded-full" aria-hidden="true" />
            <span>{t(language, 'statusStream')}</span>
          </div>
        )}

        {pendingSteering.length > 0 && (
          <span className="text-warning">{t(language, 'statusSteer', { count: String(pendingSteering.length) })}</span>
        )}
        {pendingFollowUp.length > 0 && (
          <span className="text-warning">{t(language, 'statusFollowUp', { count: String(pendingFollowUp.length) })}</span>
        )}
        {promptsWaitingElsewhere > 0 && (
          <span
            className="text-warning"
            title={t(language, 'statusPromptsWaitingOther')}
          >
            {formatPromptsWaiting(promptsWaitingElsewhere, language)}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {hasChatMessages && sessionStats?.contextUsage && (
          <div className="flex items-center gap-1 text-dim" title={t(language, 'statusContextTokens', {
            used: sessionStats.contextUsage.tokens?.toLocaleString() ?? '?',
            total: sessionStats.contextUsage.contextWindow.toLocaleString(),
          })}>
            <Layers size={10} />
            <span>
              {Number.isFinite(sessionStats.contextUsage.percent)
                ? `${Math.round(sessionStats.contextUsage.percent as number)}%`
                : '0%'}
            </span>
          </div>
        )}

        {hasChatMessages && sessionStats?.contextUsage && (
          <button
            onClick={() => compactContext()}
            disabled={isCompacting}
            className="flex items-center gap-1 text-dim hover:text-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={t(language, 'autoCompactHint')}
          >
            {isCompacting ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Minimize2 size={10} />
            )}
            <span>{isCompacting ? t(language, 'compacting') : t(language, 'compactContext')}</span>
          </button>
        )}

        {sessionStats?.cost !== undefined && sessionStats.cost > 0 && (
          <div className="flex items-center gap-1 text-dim">
            <DollarSign size={10} />
            <span>${sessionStats.cost.toFixed(2)}</span>
          </div>
        )}

        <button
          data-workflow-toggle="true"
          onClick={() => {
            const state = useAppStore.getState()
            if (state.workflowPanelOpen) state.setWorkflowPanelOpen(false)
            else if (state.sessionState?.sessionId) state.openWorkflowRunsForSession(state.sessionState.sessionId)
            else state.setWorkflowPanelOpen(true)
          }}
          className={clsx(
            'flex items-center gap-1 transition-colors',
            workflowPanelOpen || activeWorkflowCount > 0 ? 'text-accent-fg' : 'text-dim hover:text-secondary'
          )}
          title="Open workflow runs"
          aria-label="Open workflow runs"
        >
          <WorkflowIcon size={11} />
          <span>{activeWorkflowCount > 0 ? String(activeWorkflowCount) : 'wf'}</span>
        </button>

        <button
          onClick={toggleTerminal}
          className={clsx(
            'rounded-sm p-0.5 transition-colors',
            terminalOpen ? 'text-accent-fg' : 'text-dim hover:text-secondary'
          )}
          title={terminalOpen ? t(language, 'hideTerminal') : t(language, 'showTerminal')}
          aria-label={terminalOpen ? t(language, 'hideTerminal') : t(language, 'showTerminal')}
        >
          <Terminal size={12} />
        </button>

        <button
          onClick={toggleSidebar}
          className="rounded-sm p-0.5 text-dim hover:text-secondary transition-colors"
          title={sidebarOpen ? t(language, 'hideSidebar') : t(language, 'showSidebar')}
          aria-label={sidebarOpen ? t(language, 'hideSidebar') : t(language, 'showSidebar')}
        >
          {sidebarOpen ? <PanelLeftClose size={12} /> : <PanelLeft size={12} />}
        </button>
      </div>
    </div>
  )
}
