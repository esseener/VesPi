import { useMemo } from 'react'
import { AlertCircle, CheckCircle2, FolderOpen, GitBranch, MessageSquarePlus, PanelLeft, Plus, Settings, X, XCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { useAppStore } from '../store'
import { useGlobalWorkflowOpen } from '../hooks'
import { getSessionTitle } from '../utils/session-title'
import { pathsEqual } from '../../../shared/path-compare'
import { SessionRuntimeIndicator } from './session-runtime-indicator'
import type { Workspace } from '../../../shared/ipc-contracts'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import { WindowControls } from './window-controls'
import { useContextMenu, buildWorkspaceContextMenu } from './context-menu'

function tabLabel(workspace: Workspace): string {
  return workspace.name || workspace.path.split(/[\\/]/).filter(Boolean).pop() || workspace.path
}

export function WorkspaceTabs(): React.JSX.Element {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const workspaces = useAppStore((state) => state.workspaces)
  const activeWorkspace = useAppStore((state) => state.activeWorkspace)

  const sessionList = useAppStore((state) => state.sessionList)
  const sessionRuntimes = useAppStore((state) => state.sessionRuntimes)
  const activeSessionRuntimeId = useAppStore((state) => state.activeSessionRuntimeId)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const workspaceActivity = useAppStore((state) => state.workspaceActivity)
  const currentView = useAppStore((state) => state.currentView)
  const globalWorkflowOpen = useGlobalWorkflowOpen()
  const setWorkflowPanelOpen = useAppStore((state) => state.setWorkflowPanelOpen)
  const activateWorkspace = useAppStore((state) => state.activateWorkspace)
  const switchSession = useAppStore((state) => state.switchSession)
  const closeSessionTab = useAppStore((state) => state.closeSessionTab)
  const removeWorkspace = useAppStore((state) => state.removeWorkspace)
  const createWorktreeTab = useAppStore((state) => state.createWorktreeTab)
  const createNewSession = useAppStore((state) => state.createNewSession)
  const setCurrentView = useAppStore((state) => state.setCurrentView)
  const { show: showContextMenu, ContextMenuComponent } = useContextMenu()

  const toolView = ['settings', 'packages', 'notes', 'skills', 'about'] as const
  const toolsActive =
    toolView.includes(currentView as (typeof toolView)[number]) || globalWorkflowOpen

  const tabs = useMemo(
    () => [...workspaces].sort((a, b) => a.createdAt - b.createdAt),
    [workspaces]
  )
  const sessionTabs = useMemo(
    () => Object.values(sessionRuntimes)
      .filter((runtime) => runtime.workspaceId === activeWorkspace?.id && !runtime.closed)
      // Oldest first so a new tab appears on the right and the + button follows it.
      .sort((a, b) => a.runtimeId.localeCompare(b.runtimeId)),
    [activeWorkspace?.id, sessionRuntimes]
  )

  return (
    <>
    <div className="flex shrink-0 flex-col bg-transparent">
    <div className="flex h-10 items-end gap-px overflow-x-auto border-b border-border pl-1.5">
      <div className="titlebar-drag flex min-w-0 flex-1 items-end gap-px self-stretch">
      {!sidebarOpen && (
        <button
          type="button"
          onClick={toggleSidebar}
          className="titlebar-no-drag mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
          title="Show sidebar"
          aria-label="Show sidebar"
        >
          <PanelLeft size={14} />
        </button>
      )}
      {tabs.map((workspace) => {
        const active = workspace.id === activeWorkspace?.id && !toolsActive
        const activity = workspaceActivity[workspace.id]
        const isWorktree = workspace.kind === 'worktree'
        const isWorking = activity?.state === 'working'
        const needsApproval = activity?.state === 'needs-approval'
        const completed = activity?.state === 'completed'
        const failed = activity?.state === 'failed'

        return (
          <div
            key={workspace.id}
            onContextMenu={(event) => {
              showContextMenu(event, buildWorkspaceContextMenu(workspace.path))
            }}
            onAuxClick={(event) => {
              if (event.button !== 1) return
              event.preventDefault()
              void removeWorkspace(workspace.id)
            }}
            className={clsx(
              'titlebar-no-drag group flex h-7 min-w-[128px] max-w-[220px] shrink-0 items-center gap-1.5 border-b px-2 text-[11px] transition-colors',
              active
                ? 'border-accent-fg text-primary'
                : 'border-transparent text-muted hover:text-secondary'
            )}
          >
            <button
              type="button"
              onClick={() => {
                setWorkflowPanelOpen(false)
                if (workspace.id === activeWorkspace?.id) {
                  setCurrentView('chat')
                  return
                }
                void activateWorkspace(workspace.id).then((switched) => {
                  if (switched) setCurrentView('chat')
                })
              }}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              title={`${workspace.path}${workspace.branch ? `\n${workspace.branch}` : ''}`}
            >
              {isWorktree ? (
                <GitBranch size={12} className="shrink-0 text-special" />
              ) : (
                <FolderOpen size={12} className="shrink-0 text-dim" />
              )}
              <span className="min-w-0 flex-1 truncate font-jetbrains">{tabLabel(workspace)}</span>
              {isWorking && <span className="run-silver h-2.5 w-2.5 shrink-0 rounded-full" aria-hidden="true" />}
              {needsApproval && <AlertCircle size={11} className="shrink-0 text-warning" />}
              {completed && <CheckCircle2 size={11} className="shrink-0 text-success" />}
              {failed && <XCircle size={11} className="shrink-0 text-error" />}
            </button>
            {tabs.length > 1 && (
              <button
                type="button"
                onClick={() => void removeWorkspace(workspace.id)}
                className="shrink-0 rounded-sm p-0.5 text-faint opacity-0 transition-all hover:bg-highlight hover:text-primary group-hover:opacity-100"
                title={isWorktree ? 'Close tab' : 'Remove workspace'}
                aria-label={isWorktree ? `Close ${tabLabel(workspace)}` : `Remove ${tabLabel(workspace)}`}
              >
                <X size={11} />
              </button>
            )}
          </div>
        )
      })}

      {toolsActive && (
        <div className="group flex h-7 min-w-[120px] shrink-0 items-center border-b border-accent-fg text-primary">
          <div
            aria-current="page"
            className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-[11px]"
            title="Tools"
          >
            <Settings size={12} className="shrink-0 text-accent-fg" />
            <span className="truncate font-jetbrains">Tools</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setWorkflowPanelOpen(false)
              setCurrentView('chat')
            }}
            className="mr-1 rounded-sm p-0.5 text-faint opacity-0 transition-all hover:bg-highlight hover:text-primary group-hover:opacity-100"
            title="Close tools"
            aria-label="Close tools"
          >
            <X size={11} />
          </button>
        </div>
      )}
      </div>
      <WindowControls />
    </div>
    {activeWorkspace && (
      <div className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/70 px-2">
        <span className="mr-1 shrink-0 text-[10px] uppercase tracking-wide text-faint">{t(language, 'sessions')}</span>

        {sessionTabs.map((runtime) => {
          const session = sessionList.find((item) => runtime.sessionPath && pathsEqual(item.path, runtime.sessionPath))
          const active = runtime.runtimeId === activeSessionRuntimeId || runtime.active
          return (
            <div
              key={runtime.runtimeId}
              onAuxClick={(event) => {
                if (event.button !== 1) return
                event.preventDefault()
                void closeSessionTab(runtime.runtimeId)
              }}
              className={clsx(
                'group flex min-w-0 max-w-[240px] shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[11px] transition-colors',
                active ? 'bg-card text-primary' : 'text-muted hover:bg-highlight hover:text-secondary'
              )}
            >
              <button
                type="button"
                onClick={() => {
                  setCurrentView('chat')
                  if (runtime.runtimeId === activeSessionRuntimeId) return
                  if (!runtime.sessionPath) return
                  void switchSession(runtime.sessionPath, activeWorkspace?.path)
                }}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-0.5 text-left"
                title={runtime.sessionPath ?? t(language, 'newSession')}
                aria-current={active ? 'page' : undefined}
              >
                <SessionRuntimeIndicator runtime={runtime} />
                <span className="truncate">
                  {session ? getSessionTitle(session.name, session.sessionId, session.preview) : t(language, 'newSession')}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void closeSessionTab(runtime.runtimeId)}
                className="shrink-0 rounded p-0.5 text-faint opacity-0 transition-all hover:bg-highlight-strong hover:text-primary group-hover:opacity-100"
                title={t(language, 'closeSessionTab')}
                aria-label={t(language, 'closeSessionTab')}
              >
                <X size={11} />
              </button>
            </div>
          )
        })}
        <button
          type="button"
          onClick={() => {
            setWorkflowPanelOpen(false)
            setCurrentView('chat')
            void createNewSession()
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center text-muted transition-colors hover:text-primary"
          title={`${t(language, 'newSession')} (Ctrl+N)`}
          aria-label={t(language, 'newSession')}
        >
          <MessageSquarePlus size={14} />
        </button>
        <button
          type="button"
          onClick={() => void createWorktreeTab()}
          className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center text-muted transition-colors hover:text-primary"
          title={t(language, 'newIsolatedGitTab')}
          aria-label={t(language, 'newIsolatedGitTab')}
        >
          <Plus size={14} />
        </button>
      </div>
    )}
    </div>
    {ContextMenuComponent}
    </>
  )
}
