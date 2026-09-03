import { useAppStore, countPromptsWaitingElsewhere, formatPromptsWaiting } from '../store'
import { summarizeBackgroundActivity, workspaceActivityIndicator } from './sidebar-activity'
import { pathGroupKey, pathsEqual } from '../../../shared/path-compare'
import { clsx } from 'clsx'
import {
  Home,
  Settings,
  FolderOpen,
  Plus,
  PanelLeftClose,
  Clock,
  Package,
  Layers,
  ChevronDown,
  Check,
  Trash2,
  StickyNote,
  Archive,
  Blocks,
  Info,
  Pencil,
  Workflow as WorkflowIcon,
} from 'lucide-react'

import { useMemo, useState, useRef } from 'react'
import { StatusPopover } from './status-popover'
import { useContextMenu, buildSessionContextMenu, buildWorkspaceContextMenu } from './context-menu'
import { getSessionEngineLabel, getSessionRowLabels, hasMixedSessionEngines } from './sidebar-session-labels'
import { ResizeHandle } from './resize-handle'
import { getSessionTitle } from '../utils/session-title'
import { formatRelativeTime } from '../utils/format-relative-time'
import { SessionRuntimeIndicator } from './session-runtime-indicator'
import { resolveRunSessionId } from '../utils/workflow-runs'
import { useGlobalWorkflowOpen } from '../hooks'
import { clampSidebarWidth, resolveSidebarWidth } from '../../../shared/sidebar-width'
import type { SessionListItem } from '../../../shared/ipc-contracts'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import vespiCenterLogo from '../assets/vespi-center-logo.png'


/** Views reachable from the sidebar's Tools group. */
type ToolView = 'packages' | 'notes' | 'settings' | 'about'

/** Cap how many workspace groups appear in the Recent list. */
const MAX_RECENT_GROUPS = 12
/** Cap sessions shown inside an expanded workspace group. */
const MAX_SESSIONS_PER_GROUP = 12

interface RecentSessionGroup {
  projectPath: string
  projectName: string
  sessions: SessionListItem[]
  latest: SessionListItem
}

export function Sidebar(): React.JSX.Element {
  const currentView = useAppStore((state) => state.currentView)
  const setCurrentView = useAppStore((state) => state.setCurrentView)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const sessionState = useAppStore((state) => state.sessionState)
  const sessionList = useAppStore((state) => state.sessionList)
  const sessionRuntimes = useAppStore((state) => state.sessionRuntimes)
  const activeSessionRuntimeId = useAppStore((state) => state.activeSessionRuntimeId)
  const createNewSession = useAppStore((state) => state.createNewSession)
  const openFolderAsWorkspace = useAppStore((state) => state.openFolderAsWorkspace)
  const openWorkflowRunsForSession = useAppStore((state) => state.openWorkflowRunsForSession)
  const setWorkflowPanelOpen = useAppStore((state) => state.setWorkflowPanelOpen)
  const globalWorkflowOpen = useGlobalWorkflowOpen()
  const setSessionsScope = useAppStore((state) => state.setSessionsScope)
  const activeWorkspace = useAppStore((state) => state.activeWorkspace)
  const archivedSessions = useAppStore((state) => state.archivedSessions)
  const archiveSession = useAppStore((state) => state.archiveSession)
  const unarchiveSession = useAppStore((state) => state.unarchiveSession)
  const deleteSession = useAppStore((state) => state.deleteSession)
  const setSessionName = useAppStore((state) => state.setSessionName)
  const persistedWidth = useAppStore((state) => state.settings?.sidebarWidth)
  const saveSidebarWidth = useAppStore((state) => state.saveSidebarWidth)
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const updateInfo = useAppStore((state) => state.updateInfo)
  const updateDismissed = useAppStore((state) => state.updateDismissed)


  const { show: showMenu, ContextMenuComponent: SessionMenu } = useContextMenu()

  const [archivedOpen, setArchivedOpen] = useState(false)

  // The live width during a drag. Kept local so dragging never writes
  // settings.json; the draft outlives the drag so the row does not jump while the
  // save round-trips, and a remount falls back to the saved value.
  const [widthDraft, setWidthDraft] = useState<number | null>(null)
  const sidebarWidth = resolveSidebarWidth(widthDraft, persistedWidth)
  const savedWidth = resolveSidebarWidth(null, persistedWidth)
  // The handle registers its mousemove listener once per drag, so its callback
  // closes over a single render. Deltas must therefore accumulate through the
  // state updater — reading the width off a render-scoped value (or a ref written
  // during render) drops every event that lands before React re-renders.
  const widthRef = useRef(sidebarWidth)

  const applyResizeDelta = (delta: number): void => {
    setWidthDraft((current) => {
      const next = clampSidebarWidth((current ?? savedWidth) + delta)
      // Mirrored for onResizeEnd, which has no access to the updated state.
      widthRef.current = next
      return next
    })
  }

  // Inline session rename. Only the active session can be renamed (Pi's rename
  // targets it), and it's reachable from two spots — the Current Session panel
  // (`'current'`) and its highlighted row in Recent Sessions (`'recent'`).
  const [renamingWhere, setRenamingWhere] = useState<'current' | 'recent' | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameCancelRef = useRef(false)
  const [confirmingDeletePath, setConfirmingDeletePath] = useState<string | null>(null)

  const startSessionRename = (where: 'current' | 'recent'): void => {
    renameCancelRef.current = false
    // Prefill with the explicit name only; a timestamp/guid is not a name.
    setRenameValue(sessionState?.sessionName ?? '')
    setRenamingWhere(where)
  }

  // Single commit path (both Enter and Escape blur the input, which lands here).
  const finishSessionRename = (): void => {
    const cancelled = renameCancelRef.current
    renameCancelRef.current = false
    setRenamingWhere(null)
    // Pi's set_session_name RPC rejects an empty name ("cannot be empty"), so an
    // empty commit is a no-op (keeps the current name) rather than a doomed call.
    const trimmed = renameValue.trim()
    if (!cancelled && trimmed) setSessionName(trimmed)
  }

  const renderRenameInput = (): React.JSX.Element => (
    <input
      type="text"
      value={renameValue}
      onChange={(e) => setRenameValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          renameCancelRef.current = true
          e.currentTarget.blur()
        }
      }}
      onBlur={finishSessionRename}
      placeholder="Session name"
      autoFocus
      className="min-w-0 flex-1 rounded border border-border-strong bg-card px-2 py-0.5 text-sm text-primary placeholder:text-faint focus:border-focus focus:outline-none"
    />
  )

  // Archived sessions live in their own collapsible section; Recent excludes them.
  const activeSessions = useMemo(
    () => sessionList.filter((s) => !(s.sessionId in archivedSessions)),
    [sessionList, archivedSessions]
  )
  const archivedList = useMemo(
    () => sessionList.filter((s) => s.sessionId in archivedSessions),
    [sessionList, archivedSessions]
  )

  // Group recents by project folder (path). Display name = folder basename.
  const recentGroups = useMemo((): RecentSessionGroup[] => {
    // Group key is case-fold only on win32 (shared path-compare helper).
    const byProject = new Map<string, { displayPath: string; sessions: SessionListItem[] }>()
    for (const session of activeSessions) {
      const displayPath = session.projectPath || 'unknown'
      const key = pathGroupKey(displayPath)
      const existing = byProject.get(key)
      if (existing) existing.sessions.push(session)
      else byProject.set(key, { displayPath, sessions: [session] })
    }

    const groups: RecentSessionGroup[] = []
    for (const { displayPath, sessions } of byProject.values()) {
      const sorted = [...sessions].sort((a, b) => b.lastModified - a.lastModified)
      const latest = sorted[0]
      if (!latest) continue
      const folderName =
        latest.projectName?.trim() ||
        displayPath.split(/[\\/]/).filter(Boolean).pop() ||
        displayPath
      groups.push({
        projectPath: displayPath,
        projectName: folderName,
        sessions: sorted.slice(0, MAX_SESSIONS_PER_GROUP),
        latest,
      })
    }

    groups.sort((a, b) => b.latest.lastModified - a.latest.lastModified)
    return groups.slice(0, MAX_RECENT_GROUPS)
  }, [activeSessions])

  // Explicit expand/collapse overrides. Folders default to collapsed except the
  // one that contains the active session (until the user toggles).
  const [expandOverride, setExpandOverride] = useState<Record<string, boolean>>({})

  const activeProjectKey = useMemo(() => {
    if (!sessionState?.sessionFile) return null
    const active = activeSessions.find((s) => s.path === sessionState.sessionFile)
    return active ? pathGroupKey(active.projectPath || 'unknown') : null
  }, [activeSessions, sessionState?.sessionFile])

  const isGroupExpanded = (projectPath: string): boolean => {
    const key = pathGroupKey(projectPath)
    if (Object.prototype.hasOwnProperty.call(expandOverride, key)) {
      return expandOverride[key]
    }
    return activeProjectKey === key
  }

  const toggleGroup = (projectPath: string): void => {
    const key = pathGroupKey(projectPath)
    setExpandOverride((prev) => ({
      ...prev,
      [key]: !isGroupExpanded(projectPath),
    }))
  }

  // Gated on every known session, not on one section's slice, so the same chat
  // carries the same tag in Recent, in a folder group and under Archived.
  const showEngineTags = useMemo(() => hasMixedSessionEngines(sessionList), [sessionList])

  const recentSessionsForWorkspace = useMemo(() => {
    if (!activeWorkspace?.path) return []
    return activeSessions
      .filter((session) => pathsEqual(session.projectPath, activeWorkspace.path))
      .sort((a, b) => b.lastModified - a.lastModified)
      .slice(0, MAX_SESSIONS_PER_GROUP)
  }, [activeSessions, activeWorkspace?.path])

  const startNewSession = async (): Promise<void> => {
    if (!activeWorkspace) {
      setCurrentView('home')
      return
    }
    setCurrentView('chat')
    await createNewSession()
  }

  const openProject = async (): Promise<void> => {
    const path = await window.piDesktop.system.openDialog({ title: t(language, 'openProject') })
    if (path) await openFolderAsWorkspace(path)
  }

  // A tool view is only "showing" when nothing covers it — the global workflow
  // surface replaces the main pane while currentView stays put behind it.
  const toolViewShowing = (view: ToolView): boolean => currentView === view && !globalWorkflowOpen

  // Tool entries are toggles, like every other tab-like control here: clicking
  // the one already on screen returns to Chat (what the Tools tab's close
  // button does), while a covered one is revealed rather than dismissed.
  const openToolView = (view: ToolView): void => {
    const showing = toolViewShowing(view)
    setWorkflowPanelOpen(false)
    setCurrentView(showing ? 'chat' : view)
  }

  // Workspace auto-switch/create + session switch + show Chat, shared with the
  // session panel and the quick switcher.
  const openSession = useAppStore((state) => state.openSessionItem)

  const handleSessionRightClick = (e: React.MouseEvent, session: SessionListItem): void => {
    // Prevent the app-level document-level contextmenu handler from also
    // firing (which would build & show a *default* menu on top of ours).
    // React's synthetic stopPropagation isn't enough — that handler is
    // attached to `document` and fires on native bubbling.
    e.nativeEvent.stopPropagation()
    const isActive = sessionState?.sessionFile === session.path
    showMenu(
      e,
      buildSessionContextMenu(session, session.sessionId in archivedSessions, {
        onOpen: (s) => { openSession(s) },
        onArchive: (id) => archiveSession(id),
        onUnarchive: (id) => unarchiveSession(id),
        onDelete: (s) => { setConfirmingDeletePath(s.path) },
        // Rename only offered for the active session (Pi renames the active one).
        onRename: isActive ? () => startSessionRename('recent') : undefined,
        onRuns: (s) => openWorkflowRunsForSession(resolveRunSessionId(s.piSessionId, s.sessionId) ?? s.sessionId),
      })
    )
  }

  // Right-click menu for the Current Session panel — same active session, so
  // just the rename affordance.
  const handleCurrentSessionRightClick = (e: React.MouseEvent): void => {
    e.nativeEvent.stopPropagation()
    showMenu(e, [
      {
        id: 'current-session-rename',
        label: t(language, 'renameEllipsis'),
        icon: <Pencil size={14} />,
        action: () => startSessionRename('current'),
      },
    ])
  }

  const renderSessionRow = (
    session: SessionListItem,
    options?: { nested?: boolean }
  ): React.JSX.Element => {
    const labels = getSessionRowLabels(session)
    // Runs are keyed by Pi's header UUID, never the filename stem (the
    // tags/archive registry key). The stem suffix IS the UUID, so it is a
    // safe fallback when a row's header is unreadable.
    const workflowSessionId = resolveRunSessionId(session.piSessionId, session.sessionId) ?? session.sessionId
    const runtime = Object.values(sessionRuntimes).find((item) => item.sessionPath && pathsEqual(item.sessionPath, session.path))
    const isActive = sessionState?.sessionFile === session.path || runtime?.runtimeId === activeSessionRuntimeId
    const nested = options?.nested ?? false
    const engineLabel = showEngineTags ? getSessionEngineLabel(session) : null

    // Inline rename for the active row.
    if (isActive && renamingWhere === 'recent') {
      return (
        <div
          key={session.path}
          className={clsx(
            'flex w-full items-center gap-2 rounded bg-card px-2 py-1.5',
            nested && 'pl-2'
          )}
        >
          <Clock size={12} className="shrink-0 text-muted" />
          {renderRenameInput()}
        </div>
      )
    }

    if (confirmingDeletePath === session.path) {
      return (
        <div
          key={session.path}
          className={clsx(
            'rounded-sm border border-error bg-error-bg/40 px-2 py-1.5',
            nested && 'pl-2'
          )}
        >
          <div className="flex items-start gap-2">
            <Trash2 size={12} className="mt-0.5 shrink-0 text-error" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-primary" title={labels.title}>
                {labels.title}
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-error">
                {t(language, 'deleteSessionInline', { name: labels.title })}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => { void window.piDesktop.system.openTrash() }}
                  className="mr-auto rounded px-1.5 py-0.5 text-[11px] text-muted hover:text-primary"
                >
                  {t(language, 'openRecycleBin')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDeletePath(null)}
                  className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:text-primary"
                >
                  {t(language, 'cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void deleteSession(session)
                    setConfirmingDeletePath(null)
                  }}
                  className="rounded-md border border-error bg-transparent px-1.5 py-0.5 text-[11px] text-error transition-colors hover:border-error-hover"
                >
                  {t(language, 'confirmRemove')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div key={session.path} className="group relative">
        <button
          onClick={() => openSession(session)}
          onDoubleClick={() => { if (isActive) startSessionRename('recent') }}
          onContextMenu={(e) => handleSessionRightClick(e, session)}
          // The full title leads, so a preview too long for the current width is
          // still readable on hover.
          title={`${labels.title}\n\n${isActive
            ? 'Click to open · double-click to rename · right-click for actions'
            : 'Click to open · right-click for actions'}`}
          className={clsx(
            'flex w-full items-center gap-2 rounded-sm px-2 py-1 pr-7 text-left text-xs transition-colors',
            nested && 'pl-2',
            isActive
              ? 'bg-card/80 text-primary'
              : 'hover:bg-highlight text-muted hover:text-secondary'
          )}

        >
          <Clock size={12} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate">{labels.title}</div>
            {/* The title is now the session's name or first message, so the time it
                displaced moves here. Recent rows are already grouped by workspace,
                which makes the project name the less useful of the two subtitles —
                the home screen, which is not grouped, shows the project instead.
                The engine leads the line only when both engines are present. */}
            <div className="truncate text-[11px] text-faint">
              {engineLabel && `${engineLabel} · `}
              {formatRelativeTime(session.lastModified, Date.now(), language)}
            </div>
          </div>
          {runtime && <SessionRuntimeIndicator runtime={runtime} />}
        </button>
        {/* Sibling (not child) of the row button, so no nested interactive
            elements: the row's click/double-click/context-menu never fire for
            this icon. Shows an empty filtered state when the session has no runs. */}
        <button
          type="button"
          onClick={() => openWorkflowRunsForSession(workflowSessionId)}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-faint opacity-0 transition-opacity hover:bg-highlight hover:text-accent-fg focus-visible:opacity-100 group-hover:opacity-100"
          title={t(language, 'workflowRunsForSession')}
          aria-label={t(language, 'workflowRunsForSession')}
        >
          <WorkflowIcon size={12} />
        </button>
      </div>
    )
  }

  const renderRecentGroup = (group: RecentSessionGroup): React.JSX.Element => {
    const expanded = isGroupExpanded(group.projectPath)
    const isCurrentFolder =
      !!activeWorkspace?.path && pathsEqual(activeWorkspace.path, group.projectPath)
    const count = group.sessions.length

    return (
      <div key={pathGroupKey(group.projectPath)} className="mb-1">
        {/* Folder header — primary grouping unit */}
        <button
          type="button"
          onClick={() => toggleGroup(group.projectPath)}
          title={group.projectPath}
          aria-expanded={expanded}
          className={clsx(
            'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left transition-colors',
            isCurrentFolder
              ? 'bg-accent-bg/40 text-primary'
              : 'text-secondary hover:bg-highlight hover:text-primary'
          )}
        >
          <ChevronDown
            size={12}
            className={clsx(
              'shrink-0 text-dim transition-transform',
              !expanded && '-rotate-90'
            )}
          />
          <FolderOpen
            size={12}
            className={clsx('shrink-0', isCurrentFolder ? 'text-accent-fg' : 'text-dim')}
          />
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {group.projectName}
          </span>
          <span className="shrink-0 text-[10px] text-faint">
            {count}
          </span>
        </button>

        {expanded && (
          <div className="mt-0.5 space-y-0.5 border-l border-border/70 ml-3 pl-1">
            {group.sessions.map((session) =>
              renderSessionRow(session, { nested: true })
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
    <aside
      className="sidebar-console flex shrink-0 flex-col"
      style={{ width: sidebarWidth }}
    >
      <div className="titlebar-drag flex h-12 items-center justify-between border-b border-border/80 px-2">
        <div className="flex items-center gap-1.5">
          <div className="titlebar-no-drag">
            <StatusPopover />
          </div>
          <button
            type="button"
            onClick={() => setCurrentView('home')}
            className={clsx(
              'titlebar-no-drag rounded-sm p-1 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus',
              currentView === 'home'
                ? 'text-primary'
                : 'text-muted hover:text-primary'
            )}
            title={t(language, 'homeEsc')}
            aria-label={t(language, 'home')}
          >
            <Home size={14} />
          </button>
          <img src={vespiCenterLogo} alt={t(language, 'appName')} draggable={false} className="relative -top-0.5 h-4 w-auto max-w-[4.25rem]" />
        </div>
        <button
          onClick={toggleSidebar}
          className="titlebar-no-drag rounded-sm p-1 text-muted hover:text-primary"
          title={t(language, 'closeSidebar')}
          aria-label={t(language, 'closeSidebar')}
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      <div className="border-b border-border/80 pb-2">
        <div className="flex items-center justify-between px-2 pt-2">
          <div className="sidebar-kicker">{t(language, 'project')}</div>
          <button
            type="button"
            onClick={() => void openProject()}
            className="rounded-sm p-1 text-muted transition-colors hover:bg-highlight hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
            title={t(language, 'openProjectShortcut')}
            aria-label={t(language, 'openProjectFolder')}
          >
            <FolderOpen size={13} />
          </button>
        </div>
        <WorkspaceSwitcher onOpenProject={() => void openProject()} />
        <div className="px-2">
          <button
            type="button"
            onClick={() => void startNewSession()}
            disabled={!activeWorkspace}
            className="group flex w-full items-center gap-2 rounded-sm border border-border-strong bg-transparent px-2 py-1.5 text-xs font-medium text-primary transition-colors hover:border-accent-fg hover:text-accent-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
            title={activeWorkspace ? t(language, 'startNewSession') : t(language, 'openAProjectFirst')}
          >
            <Plus size={13} className="shrink-0" />
            <span className="flex-1 text-left">{t(language, 'newSession')}</span>
            <kbd className="rounded-sm border border-border px-1 py-px font-jetbrains text-[9px] font-medium text-faint">Ctrl N</kbd>
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        <div className="mb-1 flex items-center justify-between px-2">
          <div className="sidebar-kicker min-w-0 truncate">{t(language, 'sessions')}</div>
          <button
            type="button"
            onClick={() => {
              setSessionsScope('all')
              setCurrentView('sessions')
            }}
            className="font-jetbrains text-[10px] text-muted transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
          >
            {t(language, 'viewAll')}
          </button>
        </div>
        {activeWorkspace ? (
          recentSessionsForWorkspace.length === 0 ? (
            <div className="mx-1 mt-1 rounded-sm border border-dashed border-border px-2 py-3 text-center text-[11px] text-faint">
              {t(language, 'noSessionsInProject')}
              <button
                type="button"
                onClick={() => void startNewSession()}
                className="mt-1 block w-full text-secondary transition-colors hover:text-primary"
              >
                {t(language, 'startOneNow')}
              </button>
            </div>
          ) : (
            <div className="space-y-px">
              {recentSessionsForWorkspace.map((session) => renderSessionRow(session))}
            </div>
          )
        ) : recentGroups.length === 0 ? (
          <div className="mx-1 mt-1 rounded-sm border border-dashed border-border px-2 py-3 text-center text-[11px] text-faint">
            {t(language, 'openProjectToSeeSessions')}
          </div>
        ) : (
          recentGroups.map(renderRecentGroup)
        )}
      </div>


      {archivedList.length > 0 && (
        <div className="shrink-0 border-t border-border/80 px-1.5 py-1">
          <button
            type="button"
            onClick={() => setArchivedOpen((open) => !open)}
            className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] text-muted hover:bg-surface-hover hover:text-primary"
            title={archivedOpen ? t(language, 'collapseArchived') : t(language, 'expandArchived')}
          >
            <ChevronDown
              size={11}
              className={clsx('shrink-0 transition-transform', !archivedOpen && '-rotate-90')}
            />
            <Archive size={11} className="shrink-0" />
            <span>{t(language, 'archived')} ({archivedList.length})</span>
          </button>
          {archivedOpen && (
            <div className="max-h-48 overflow-y-auto pb-1">
              {archivedList.map((session) => renderSessionRow(session))}
            </div>
          )}
        </div>
      )}

      <div className="shrink-0 border-t border-border/80 px-1.5 py-1.5">
        <div className="sidebar-kicker mb-1 px-2">{t(language, 'tools')}</div>
        <div className="grid grid-cols-2 gap-px">
          <SidebarItem
            compact
            icon={<Blocks size={12} />}
            label={t(language, 'extensions')}
            active={toolViewShowing('packages')}
            onClick={() => openToolView('packages')}
          />
          <SidebarItem
            compact
            icon={<StickyNote size={12} />}
            label={t(language, 'notes')}
            active={toolViewShowing('notes')}
            onClick={() => openToolView('notes')}
          />
          <SidebarItem
            compact
            icon={<Info size={12} />}
            label={t(language, 'about')}
            active={toolViewShowing('about')}
            onClick={() => openToolView('about')}
            badge={(updateInfo?.updateAvailable || updateInfo?.kernel.updateAvailable) && !updateDismissed}
          />
          <SidebarItem
            compact
            icon={<Settings size={12} />}
            label={t(language, 'settings')}
            active={toolViewShowing('settings')}
            onClick={() => openToolView('settings')}
          />
        </div>
      </div>


      {SessionMenu}
    </aside>
    <ResizeHandle
      onResize={applyResizeDelta}
      onResizeEnd={() => void saveSidebarWidth(widthRef.current)}
    />
    </>
  )
}

// ─── Workspace Switcher ──────────────────────────────────────────────────────

function WorkspaceSwitcher({ onOpenProject }: { onOpenProject: () => void }): React.JSX.Element {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const workspaces = useAppStore((state) => state.workspaces)
  const activeWorkspace = useAppStore((state) => state.activeWorkspace)
  const activateWorkspace = useAppStore((state) => state.activateWorkspace)
  const removeWorkspace = useAppStore((state) => state.removeWorkspace)
  const renameWorkspace = useAppStore((state) => state.renameWorkspace)
  const changeWorkspaceFolder = useAppStore((state) => state.changeWorkspaceFolder)
  const pendingPromptCounts = useAppStore((state) => state.pendingPromptCounts)
  const workspaceActivity = useAppStore((state) => state.workspaceActivity)
  const { show: showContextMenu, ContextMenuComponent: WorkspaceContextMenu } = useContextMenu()



  // Prompts held for workspaces other than the active one — the active
  // workspace's prompt is already on screen, so only elsewhere needs a badge.
  const promptsWaitingElsewhere = countPromptsWaitingElsewhere(
    pendingPromptCounts,
    activeWorkspace?.id ?? null
  )

  // Background work in non-active workspaces, condensed to one header dot.
  const backgroundActivity = summarizeBackgroundActivity(
    workspaceActivity,
    activeWorkspace?.id ?? null,
    language,
  )

  const [isOpen, setIsOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [newName, setNewName] = useState('')

  const handleRename = async () => {
    if (!activeWorkspace || !newName.trim()) return
    await renameWorkspace(activeWorkspace.id, newName.trim())
    setIsRenaming(false)
  }

  const startRenaming = () => {
    setNewName(activeWorkspace?.name ?? '')
    setIsRenaming(true)
    setIsOpen(false)
  }

  const handleChangeFolder = async () => {
    if (!activeWorkspace) return
    const path = await window.piDesktop.system.openDialog({ title: 'Select Workspace Folder' })
    if (path) await changeWorkspaceFolder(activeWorkspace.id, path)
  }

  const handleWorkspaceContextMenu = (e: React.MouseEvent, workspacePath?: string) => {
    const path = workspacePath ?? activeWorkspace?.path
    if (!path) return
    showContextMenu(e, buildWorkspaceContextMenu(path))
  }

  return (
    <div className="px-2 py-1.5">
      {isRenaming ? (
        <div className="flex items-center gap-2 rounded-sm border border-border/80 bg-transparent px-2 py-1.5">
          <Layers size={13} className="text-secondary" />
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void handleRename()
              } else if (e.key === 'Escape') {
                setIsRenaming(false)
              }
            }}
            onBlur={() => void handleRename()}
            placeholder="Workspace name"
            className="min-w-0 flex-1 rounded-sm border border-border-strong bg-transparent px-2 py-1 text-xs text-primary placeholder:text-faint focus:border-focus focus:outline-none"
            autoFocus
          />
        </div>
      ) : (
        <button
          onClick={() => setIsOpen(!isOpen)}
          onDoubleClick={startRenaming}
          onContextMenu={handleWorkspaceContextMenu}
          title="Click to switch · double-click to rename · right-click for options"
          className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-xs text-primary hover:bg-highlight transition-colors"
        >
          <div className="flex min-w-0 items-center gap-2 text-left">
            <Layers size={13} className="shrink-0 text-secondary" />
            <div className="min-w-0">
              <div className="truncate">{activeWorkspace?.name ?? 'No workspace'}</div>
              {activeWorkspace && (
                <div className="truncate font-jetbrains text-[9px] text-faint">{activeWorkspace.path}</div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {backgroundActivity && (
              <span
                className={clsx(
                  'h-2 w-2 rounded-full',
                  backgroundActivity.pulse ? 'run-silver' : backgroundActivity.colorClass,
                  backgroundActivity.pulse && 'animate-pulse'
                )}
                title={backgroundActivity.label}
              />
            )}
            {promptsWaitingElsewhere > 0 && (
              <span
                className="rounded-sm bg-warning-bg px-1.5 py-0.5 text-[10px] text-warning"
                title={formatPromptsWaiting(promptsWaitingElsewhere, language)}
              >
                {promptsWaitingElsewhere}
              </span>
            )}
            <ChevronDown
              size={13}
              className={clsx(
                'text-dim transition-transform',
                isOpen && 'rotate-180'
              )}
            />
          </div>
        </button>
      )}
      {WorkspaceContextMenu}

      {isOpen && (
        <div className="mt-1 rounded-sm border border-border/80 bg-surface/90 py-1 animate-fade-in">
          {workspaces.map((ws) => (
            <div
              key={ws.id}
              className="group flex items-center justify-between px-2 py-1 hover:bg-surface-hover"
              onContextMenu={(e) => handleWorkspaceContextMenu(e, ws.path)}
            >
              <button
                onClick={() => {
                  void activateWorkspace(ws.id)
                  setIsOpen(false)
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <Layers size={13} className="shrink-0 text-secondary" />
                <span className="truncate text-xs text-secondary">{ws.name}</span>
                {ws.id === activeWorkspace?.id && (
                  <Check size={11} className="shrink-0 text-success" />
                )}
                {ws.id !== activeWorkspace?.id && (pendingPromptCounts[ws.id] ?? 0) > 0 && (
                  <span
                    className="shrink-0 rounded-sm bg-warning-bg px-1.5 py-0.5 text-[10px] text-warning"
                    title={formatPromptsWaiting(pendingPromptCounts[ws.id], language)}
                  >
                    {pendingPromptCounts[ws.id]}
                  </span>
                )}
                {(() => {
                  const indicator = workspaceActivityIndicator(workspaceActivity[ws.id], language)
                  return indicator ? (
                    <span
                      className={clsx(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        indicator.pulse ? 'run-silver' : indicator.colorClass,
                        indicator.pulse && 'animate-pulse'
                      )}
                      title={indicator.label}
                    />
                  ) : null
                })()}
              </button>
              {workspaces.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    removeWorkspace(ws.id)
                  }}
                  className="rounded-sm p-1 text-faint opacity-0 transition-all group-hover:opacity-100 hover:text-error"
                  title="Remove workspace"
                  aria-label="Remove workspace"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={() => {
              setIsOpen(false)
              onOpenProject()
            }}
            className="flex w-full items-center gap-2 border-t border-border/80 px-2 py-1.5 text-[11px] text-muted transition-colors hover:bg-surface-hover hover:text-secondary"
          >
            <FolderOpen size={12} />
            {t(language, 'openProject')}
          </button>
        </div>
      )}
    </div>
  )
}


// ─── Sidebar Item ────────────────────────────────────────────────────────────

function SidebarItem({
  icon,
  label,
  active,
  onClick,
  compact = false,
  title,
  badge = false,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
  compact?: boolean
  title?: string
  badge?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={clsx(
        'sidebar-item focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus',
        compact ? 'px-2 py-1 text-[11px]' : 'px-2 py-1.5 text-xs',
        active ? 'sidebar-item-active' : 'sidebar-item-idle'
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {badge && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-secondary" aria-label="update" />}
    </button>
  )
}
