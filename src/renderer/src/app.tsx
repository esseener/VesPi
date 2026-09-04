import { Sidebar } from './components/sidebar'
import { ChatPanel } from './components/chat-panel'
import { StatusBar } from './components/status-bar'
import { SettingsPanel } from './components/settings-panel'
import { SessionPanel } from './components/session-panel'
import { Timeline } from './components/timeline'
import { PackageBrowser } from './components/package-browser'
import { DiffViewer } from './components/diff-viewer'
import { HomeScreen } from './components/home-screen'
import { NotesPanel } from './components/notes-panel'
import { DiagnosticsPanel } from './components/diagnostics-panel'
import { AboutPanel } from './components/about-panel'
import { ModelSetupScreen } from './components/model-setup-screen'
import { MissionControl } from './components/mission-control'
import { TaskLauncher } from './components/task-launcher'
import { NotePicker } from './components/note-picker'
import { CommandPalette } from './components/command-palette'
import { ExtensionUiDialog, AppConfirmDialog } from './components/extension-ui-dialog'
import { WorkspaceTabs } from './components/workspace-tabs'
import { WorkflowNavigator } from './components/workflow-navigator'
import { WindowControls } from './components/window-controls'
import { useContextMenu, buildDefaultContextMenu } from './components/context-menu'
import { ErrorBoundary } from './components/error-boundary'
import { usePiEvents, useMenuActions, useInitialize, useNotePickerShortcut } from './hooks'
import { useFolderDrop } from './hooks/use-folder-drop'
import { useAppStore } from './store'
import { useEffect } from 'react'
import { clsx } from 'clsx'
import { ArrowUpCircle, FolderOpen, PanelLeft, X } from 'lucide-react'
import { DEFAULT_LANGUAGE, t } from '../../shared/i18n'
import { kernelUpdateBarPercent, kernelUpdateBusy, kernelUpdateLabel } from './utils/kernel-update-progress'


export function App(): React.JSX.Element {
  usePiEvents()
  useMenuActions()
  useInitialize()
  useNotePickerShortcut()
  const { isDraggingFolder } = useFolderDrop()

  const currentView = useAppStore((state) => state.currentView)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const updateInfo = useAppStore((state) => state.updateInfo)
  const updateDismissed = useAppStore((state) => state.updateDismissed)
  const dismissUpdate = useAppStore((state) => state.dismissUpdate)
  const installKernelUpdate = useAppStore((state) => state.installKernelUpdate)
  const installUiUpdate = useAppStore((state) => state.installUiUpdate)
  const kernelUpdateProgress = useAppStore((state) => state.kernelUpdateProgress)
  const uiUpdateProgress = useAppStore((state) => state.uiUpdateProgress)
  const kernelBusy = kernelUpdateBusy(kernelUpdateProgress)
  const kernelDone = kernelUpdateProgress?.phase === 'done'
  const kernelFailed = kernelUpdateProgress?.phase === 'error'
  const uiBusy = kernelUpdateBusy(uiUpdateProgress)
  const uiDone = uiUpdateProgress?.phase === 'done'
  const uiFailed = uiUpdateProgress?.phase === 'error'
  const workflowPanelOpen = useAppStore((state) => state.workflowPanelOpen)
  const workflowPanelFilter = useAppStore((state) => state.workflowPanelFilter)
  const workflowPanelWorkspaceId = useAppStore((state) => state.workflowPanelWorkspaceId)
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)

  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN'
    document.title = 'VesPi'
  }, [language])


  // Global context menu
  const { show, ContextMenuComponent } = useContextMenu()

  // Custom menus for chrome (sessions, messages). Editable fields keep the
  // native Electron edit menu — do not preventDefault on input/textarea.
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"], [role="textbox"]')) return
      e.preventDefault()
      show(e as unknown as React.MouseEvent, buildDefaultContextMenu())
    }

    document.addEventListener('contextmenu', handleContextMenu)
    return () => document.removeEventListener('contextmenu', handleContextMenu)
  }, [show])

  // Global quick-switcher launcher (Ctrl/Cmd+K): commands, workspaces,
  // sessions, and files. No Pi-running gate — workspace/session/file
  // navigation works with Pi stopped, and command actions soft-fail the same
  // way their buttons do. Slash-typing in the composer is handled by
  // ChatInput's inline popup instead.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        useAppStore.getState().setCommandPalette(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Home is a full-screen splash (no sidebar/status). Chat keeps chrome; the
  // empty-chat center prompt is the "minimal" launch surface when not opening Home.
  const isHome = currentView === 'home' || currentView === 'model-setup'
  const showChrome = !isHome
  const updateCheckFailed = Boolean(updateInfo?.checkError || updateInfo?.kernel.checkError)
  const showUpdateBanner = kernelBusy || kernelDone || kernelFailed || uiBusy || uiDone || uiFailed || updateCheckFailed || (!!updateInfo && (updateInfo.updateAvailable || updateInfo.kernel.updateAvailable) && !updateDismissed)
  const globalWorkflowOpen =
    showChrome && workflowPanelOpen && !workflowPanelFilter && workflowPanelWorkspaceId === null

  return (
    <div className="app-console relative flex h-screen flex-col bg-app text-primary">
      <div className="app-console-mesh" aria-hidden="true" />
      {isHome && <WindowControls overlay />}
      {isHome && !showUpdateBanner && (
        <div className="titlebar-drag-overlay titlebar-drag absolute inset-x-0 top-0 z-40 h-10" aria-hidden="true" />
      )}
      {isDraggingFolder && (
        <div
          className="pointer-events-none absolute inset-0 z-[100] flex items-center justify-center bg-app/80 backdrop-blur-sm"
          aria-live="polite"
        >
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-surface/95 px-10 py-8 shadow-xl shadow-black/40">
            <FolderOpen size={36} className="text-accent" />
            <div className="text-center">
              <div className="text-base font-semibold text-primary">
                {t(language, 'dropFolderTitle')}
              </div>
              <div className="mt-1 text-sm text-dim">
                {t(language, 'dropFolderHint')}
              </div>
            </div>
          </div>
        </div>
      )}
      {showUpdateBanner && (
        <div className="titlebar-no-drag relative z-50 flex shrink-0 items-center justify-center gap-3 border-b border-border bg-app/95 px-4 py-1.5 text-xs text-primary">
          <ArrowUpCircle size={14} className="shrink-0" />
          {updateCheckFailed && !kernelBusy && (
            <span className="min-w-0 truncate text-error">
              {updateInfo?.checkError || updateInfo?.kernel.checkError || t(language, 'updateCheckFailed')}
            </span>
          )}
          {(updateInfo?.updateAvailable || uiBusy || uiDone || uiFailed) && !kernelBusy && (
            <>
              <span className={clsx('min-w-0 truncate', uiDone && 'text-success', uiFailed && 'text-error')}>
                {uiBusy || uiDone || uiFailed
                  ? kernelUpdateLabel(language, uiUpdateProgress, 'ui')
                  : t(language, 'updateAvailable', { latest: `v${updateInfo!.latestVersion}`, current: `v${updateInfo!.currentVersion}` })}
              </span>
              {uiBusy ? (
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-border" aria-hidden="true">
                  <div
                    className="h-full bg-accent-fg transition-[width] duration-200"
                    style={{ width: `${kernelUpdateBarPercent(uiUpdateProgress)}%` }}
                  />
                </div>
              ) : uiFailed ? (
                <button
                  type="button"
                  onClick={() => void installUiUpdate()}
                  className="titlebar-no-drag rounded-sm border border-error px-2 py-0.5 font-medium text-error transition-colors hover:border-error-hover"
                >
                  {t(language, 'download')}
                </button>
              ) : uiDone ? null : (
                <button
                  type="button"
                  onClick={() => void installUiUpdate()}
                  disabled={!updateInfo?.installerUrl && !updateInfo?.url}
                  className="titlebar-no-drag rounded-sm border border-border-strong px-2 py-0.5 font-medium text-muted transition-colors hover:border-accent-fg hover:text-primary disabled:opacity-50"
                >
                  {t(language, 'download')}
                </button>
              )}
            </>
          )}
          {(updateInfo?.kernel.updateAvailable || kernelBusy || kernelDone || kernelFailed) && (
            <>
              <span className={clsx('min-w-0 truncate', kernelDone && 'text-success', kernelFailed && 'text-error')}>
                {kernelBusy || kernelDone || kernelFailed
                  ? kernelUpdateLabel(language, kernelUpdateProgress)
                  : t(language, 'kernelUpdateAvailable', { latest: `v${updateInfo!.kernel.latestVersion}`, current: `v${updateInfo!.kernel.currentVersion}` })}
              </span>
              {kernelBusy ? (
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-border" aria-hidden="true">
                  <div
                    className="h-full bg-accent-fg transition-[width] duration-200"
                    style={{ width: `${kernelUpdateBarPercent(kernelUpdateProgress)}%` }}
                  />
                </div>
              ) : kernelFailed ? (
                <button
                  type="button"
                  onClick={() => void installKernelUpdate()}
                  className="titlebar-no-drag rounded-sm border border-error px-2 py-0.5 font-medium text-error transition-colors hover:border-error-hover"
                >
                  {t(language, 'updateKernel')}
                </button>
              ) : kernelDone ? null : (
                <button
                  type="button"
                  onClick={() => void installKernelUpdate()}
                  disabled={!updateInfo?.kernel.downloadUrl}
                  className="titlebar-no-drag rounded-sm border border-border-strong px-2 py-0.5 font-medium text-muted transition-colors hover:border-accent-fg hover:text-primary disabled:opacity-50"
                >
                  {t(language, 'updateKernel')}
                </button>
              )}
            </>
          )}
          <button
            onClick={dismissUpdate}
            className="rounded-sm p-0.5 text-muted hover:text-primary transition-colors"
            aria-label={t(language, 'dismissUpdate')}
            title={t(language, 'dismiss')}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {isHome && !sidebarOpen && (
        <button
          type="button"
          onClick={toggleSidebar}
          className="titlebar-no-drag absolute left-3 top-3 z-50 animate-fade-in rounded-md border border-border-strong bg-surface/95 p-1.5 text-muted shadow-sm backdrop-blur-sm transition-colors hover:bg-surface-hover hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
          title={t(language, 'showSidebar')}
          aria-label={t(language, 'showSidebar')}
        >
          <PanelLeft size={16} />
        </button>
      )}

      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && showChrome && <Sidebar />}

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {showChrome && <WorkspaceTabs />}
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className={globalWorkflowOpen ? 'hidden' : 'contents'}>
                {currentView === 'home' && <HomeScreen />}
                {currentView === 'model-setup' && <ModelSetupScreen />}
                {currentView === 'mission-control' && <MissionControl />}
                <div className={currentView === 'chat' ? 'flex min-w-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
                  <ErrorBoundary>
                    <ChatPanel />
                  </ErrorBoundary>
                </div>
                {currentView === 'settings' && <SettingsPanel />}
                {currentView === 'sessions' && <SessionPanel />}
                {currentView === 'timeline' && <Timeline />}
                {currentView === 'packages' && <PackageBrowser />}
                {currentView === 'skills' && <PackageBrowser />}
                {currentView === 'diff' && <DiffViewer />}
                {currentView === 'notes' && <NotesPanel />}
                {currentView === 'diagnostics' && <DiagnosticsPanel />}
                {currentView === 'about' && <AboutPanel />}
              </div>
              {globalWorkflowOpen && <WorkflowNavigator embedded />}
            </main>
          </div>
        </div>
      </div>

      {showChrome && <StatusBar />}
      {showChrome && !globalWorkflowOpen && <WorkflowNavigator />}
      <ExtensionUiDialog />
      <AppConfirmDialog />
      <NotePicker />
      <TaskLauncher />
      <CommandPalette />
      {ContextMenuComponent}
    </div>
  )
}
