import { useAppStore } from '../store'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import { ResizeHandle } from './resize-handle'
import {
  DEFAULT_FILE_PANE_WIDTH,
  DEFAULT_SIDE_PANEL_WIDTH,
  MAX_SIDE_PANEL_WIDTH,
  MIN_EDITOR_PANE_WIDTH,
  MIN_FILE_PANE_WIDTH,
  clamp,
  resolveSidePanelMetrics,
} from './chat-panel-widths'

import { FileTree, FileSearch, FilePreview } from './file-tree'
import { ImageViewer } from './image-viewer'
import { DiffViewer } from './diff-viewer'
import { TerminalPanel } from './terminal'
import { ModelSelector } from './model-selector'
import { BrowserPanel } from './browser-panel'
import { SideTabPicker } from './side-tab-picker'
import { ReviewRail } from './review-rail'
import { useState, useCallback, useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import {
  LayoutPanelLeft,
  X,
  Square,
  Eraser,
  RotateCcw,
  Search,
  Terminal,
  Loader2,
} from 'lucide-react'

export function ChatPanel(): React.JSX.Element {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)

  const previewTarget = useAppStore((state) => state.previewTarget)
  const fileSearchOpen = useAppStore((state) => state.fileSearchOpen)
  const toggleFileSearch = useAppStore((state) => state.toggleFileSearch)

  // sidePanel lives in the store so it survives view switches (e.g. Settings
  // round-trip). Widths stay local — resetting them on remount is benign.
  const sidePanel = useAppStore((state) => state.chatSidePanel)
  const setSidePanel = useAppStore((state) => state.setChatSidePanel)
  const setPreviewTarget = useAppStore((state) => state.setPreviewTarget)

  // Closing the panel from the UI has to drop the preview target too: the panel
  // is shown whenever `sidePanel !== null || previewTarget !== null`, so a
  // lingering preview made every close button look dead — the panel stayed put
  // and the toolbar toggle stayed lit. setChatSidePanel deliberately doesn't do
  // this itself, because openFileFromChat sets the preview *first* and then
  // closes a conflicting diff pane to make room for it.
  const closeSidePanel = useCallback((): void => {
    void setPreviewTarget(null)
    void setSidePanel(null)
  }, [setPreviewTarget, setSidePanel])
  const [sidePanelWidth, setSidePanelWidth] = useState(DEFAULT_SIDE_PANEL_WIDTH)
  const [filePaneWidth, setFilePaneWidth] = useState(DEFAULT_FILE_PANE_WIDTH)
  const workbenchRef = useRef<HTMLDivElement>(null)
  const [workbenchWidth, setWorkbenchWidth] = useState(0)
  useEffect(() => {
    const node = workbenchRef.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWorkbenchWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // When the agent acts on the embedded browser, the shell brings the panel into
  // view so the user can see what it is doing. The panel is one shared surface
  // serving every workspace, so the request names the workspace it came from:
  // only the one on screen may take the panel over, and the others keep their
  // page and their flag until the user switches to them.
  const notePanelShow = useAppStore((state) => state.notePanelShow)
  useEffect(() => {
    return window.piDesktop.onPanelShow((request) => {
      notePanelShow(request.workspaceId ?? null, request.url)
    })
  }, [notePanelShow])

  const currentView = useAppStore((state) => state.currentView)
  // The global workflow view replaces the main pane while this panel stays
  // mounted behind `display: none`, so "chat is on screen" needs both checks.
  // Without the second one the scroll hook never sees the hidden→shown edge and
  // cannot re-anchor the reading position when the workflow view closes.
  const chatVisible = currentView === 'chat'
  const terminalStatus = useAppStore((state) => state.terminalStatus)
  const terminalError = useAppStore((state) => state.terminalError)
  const terminalOpen = useAppStore((state) => state.terminalOpen)
  const workspaceName = useAppStore((state) => state.activeWorkspace?.name)
  const busy = terminalStatus === 'starting'
  const connected = terminalStatus === 'running'

  const runTerminalAction = async (action: 'restart' | 'interrupt'): Promise<void> => {
    useAppStore.setState({ terminalError: null })
    try {
      if (action === 'interrupt') {
        await window.piDesktop.terminal.input('\x1b')
        return
      }
      if (!terminalOpen) {
        useAppStore.setState({ terminalOpen: true })
        return
      }
      useAppStore.setState({ terminalStatus: 'starting' })
      const result = await window.piDesktop.terminal.restart()
      if (!result.ok) throw new Error(t(language, 'statusStopped'))
      useAppStore.setState({ terminalStatus: 'running' })
    } catch (error) {
      useAppStore.setState({ terminalStatus: action === 'restart' ? 'error' : terminalStatus, terminalError: error instanceof Error ? error.message : String(error) })
    }
  }

  // In-conversation search (Ctrl/Cmd+F while in chat). The nonce bumps on every
  // press so re-triggering refocuses/selects the already-open input.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchNonce, setSearchNonce] = useState(0)
  useEffect(() => {
    // Same visibility test as the scroll hook: a hidden panel must not capture
    // the shortcut and open its find bar off screen.
    if (!chatVisible) return
    const onKey = (e: KeyboardEvent) => {
      // The 'F' (uppercase) case also covers Caps Lock. Ctrl/Cmd+F opens the
      // in-conversation find bar; adding Shift opens the workspace file-search
      // modal. Both handled here at the window level so they fire regardless of
      // focus (the file-search shortcut used to be composer-scoped, so it only
      // worked while the textarea had focus).
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        if (e.shiftKey) {
          useAppStore.getState().toggleFileSearch()
        } else {
          setSearchOpen(true)
          setSearchNonce((n) => n + 1)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chatVisible])

  const showPicker = sidePanel === 'picker'
  const showSidePanel = showPicker || sidePanel !== null || previewTarget !== null
  const showFileTree = sidePanel === 'files'
  const showImage = previewTarget?.kind === 'image' && sidePanel !== 'diff'
  const showEditor = previewTarget?.kind === 'code' && sidePanel !== 'diff'
  const showDiff = sidePanel === 'diff'
  const showReview = sidePanel === 'review'
  const showBrowser = sidePanel === 'browser'
  // Keep at least 480px for the live TUI. At the supported minimum window
  // size, stack the auxiliary pane below it instead of squeezing it to 30 cols.
  const stacked = workbenchWidth > 0 && workbenchWidth < 840
  const sideBudget = workbenchWidth ? (stacked ? workbenchWidth : workbenchWidth - 480) : MAX_SIDE_PANEL_WIDTH
  const treeBesidePreview = showFileTree && (!(showEditor || showImage) || sideBudget >= 600)
  // The page this workspace owns, remembered in the store rather than in the
  // panel: the panel unmounts whenever it is not on screen, and local state
  // would take the address (and the agent's session) with it.
  const activeWorkspaceId = useAppStore((state) => state.activeWorkspace?.id ?? null)
  const browserPanel = useAppStore((state) =>
    activeWorkspaceId === null ? undefined : state.browserPanelByWorkspace[activeWorkspaceId]
  )
  const browserUrl = browserPanel?.url ?? null
  const browserNonce = browserPanel?.nonce ?? 0
  // Once a page exists the side panel stays mounted and is hidden instead of
  // removed — unmounting destroys the `<webview>`, which is what used to kill
  // the page the agent was still driving the moment the user closed the panel.
  const sidePanelMounted = showSidePanel || browserPanel !== undefined
  const {
    fileTreeOnly: showFileTreeOnly,
    minSidePanelWidth,
    contentWidth: sidePanelContentWidth,
    filePaneWidth: effectiveFilePaneWidth,
    maxFilePaneWidth,
  } = resolveSidePanelMetrics({ showFileTree: treeBesidePreview, showEditor, showImage }, sidePanelWidth, filePaneWidth, sideBudget)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div ref={workbenchRef} className={clsx('flex min-h-0 flex-1 overflow-hidden', stacked && 'flex-col')}>
        {/* Main chat area */}
        <div className="chat-center flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* Chrome is intentionally minimal: workspace lives in the top tabs,
              terminal owns the body. Terminal interrupt / clear / restart sit
              beside the side-panel toggle — icon-only, color-coded. */}
          <div className="@container flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
            <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
              <Terminal size={16} className="shrink-0 text-accent-fg" />
              <span className="max-w-40 truncate font-medium text-primary">{workspaceName || t(language, 'terminalWorkspace')}</span>
              <span className={clsx('h-1.5 w-1.5 rounded-full', connected ? 'bg-success' : busy ? 'bg-warning animate-pulse' : 'bg-border-strong')} aria-hidden="true" />
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              <ModelSelector compact dropUp={false} />
              <ToolbarButton icon={<Search size={14} />} active={searchOpen} disabled={!terminalOpen} onClick={() => { setSearchOpen(true); setSearchNonce((n) => n + 1) }} title={t(language, 'terminalSearch')} />
              <ToolbarButton
                icon={<Square size={13} fill="currentColor" />}
                active={false}
                disabled={!connected}
                onClick={() => void runTerminalAction('interrupt')}
                title={t(language, 'terminalInterruptHint')}
                label={t(language, 'terminalInterrupt')}
              />
              <ToolbarButton
                icon={<Eraser size={12} />}
                active={false}
                disabled={!terminalOpen}
                onClick={() => window.dispatchEvent(new CustomEvent('vespi:terminal-clear'))}
                title={t(language, 'terminalClear')}
              />
              <ToolbarButton
                icon={busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                active={false}
                disabled={busy}
                onClick={() => void runTerminalAction('restart')}
                title={t(language, 'terminalRestartHint')}
                label={t(language, 'terminalRestart')}
              />
              <div className="mx-1 h-4 w-px bg-border/80" />
              <ToolbarButton
                icon={<LayoutPanelLeft size={13} />}
                active={showSidePanel}
                onClick={() => (showSidePanel ? closeSidePanel() : void setSidePanel('picker'))}
                title={showSidePanel ? t(language, 'closeSideTabs') : t(language, 'openSideTabs')}
              />
            </div>
          </div>

          {terminalError && <div role="alert" className="border-b border-border bg-surface px-4 py-2 text-xs text-error">{t(language, 'terminalActionFailed', { error: terminalError })}</div>}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {/* 唯一交互面：OMP TUI + 会打进 TUI 的命令条 */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <TerminalPanel className="flex-1" searchOpen={searchOpen} searchNonce={searchNonce} onCloseSearch={() => setSearchOpen(false)} />
              {!terminalOpen && <div className="flex flex-1 flex-col items-center justify-center gap-4 text-sm text-muted"><Terminal size={32} /><p>{t(language, 'terminalStoppedHint')}</p><button type="button" className="rounded-md border border-border-strong bg-surface px-4 py-2 text-primary hover:bg-surface-hover" onClick={() => useAppStore.setState({ terminalOpen: true })}>{t(language, 'terminalOpen')}</button></div>}
            </div>
          </div>
        </div>

        {/* Side panel */}
        {sidePanelMounted && (
          <div
            className={clsx('relative flex min-h-0 shrink-0 border-border bg-transparent', stacked ? 'border-t' : 'border-l', !showSidePanel && 'hidden')}
            style={stacked ? { width: '100%', height: '45%' } : { width: sidePanelContentWidth }}
          >
            {!stacked && <ResizeHandle
              onResize={(delta) => {
                if (showFileTreeOnly) {
                  // Same ceiling the render uses, so the state cannot outrun it.
                  setFilePaneWidth((width) =>
                    clamp(width - delta, MIN_FILE_PANE_WIDTH, maxFilePaneWidth)
                  )
                  return
                }

                setSidePanelWidth((width) =>
                  clamp(width - delta, minSidePanelWidth, MAX_SIDE_PANEL_WIDTH)
                )
              }}
            />}
            <div className="flex min-w-0 flex-1 overflow-hidden">
              {showPicker && <SideTabPicker />}
              {showReview && <ReviewRail embedded />}
              {browserPanel !== undefined && (
                <div className={clsx('min-w-0 flex-1 overflow-hidden', !showBrowser && 'hidden')}>
                  <BrowserPanel url={browserUrl} nonce={browserNonce} />
                </div>
              )}
              {treeBesidePreview && (
                <>
                  <div className="flex min-w-0 shrink-0 flex-col overflow-hidden" style={{ width: effectiveFilePaneWidth }}>
                    <FileTree />
                  </div>
                  {(showEditor || showImage) && (
                    <ResizeHandle
                      onResize={(delta) =>
                        setFilePaneWidth((width) =>
                          clamp(width + delta, MIN_FILE_PANE_WIDTH, maxFilePaneWidth)
                        )
                      }
                    />
                  )}
                </>
              )}
              {showDiff && (
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                  <DiffViewer onClose={() => void setSidePanel(null)} />
                </div>
              )}
              {showEditor && (
                <div
                  className={clsx(
                    'flex flex-1 flex-col overflow-hidden',
                    treeBesidePreview && 'border-l border-border'
                  )}
                  style={{ minWidth: MIN_EDITOR_PANE_WIDTH }}
                >
                  <FilePreview />
                </div>
              )}
              {showImage && (
                <div
                  className="flex flex-1 flex-col overflow-hidden"
                  style={{ minWidth: MIN_EDITOR_PANE_WIDTH }}
                >
                  <ImageViewer />
                </div>
              )}
            </div>
            {!showPicker && (
              <button
                onClick={closeSidePanel}
                className="absolute top-1 right-1 z-10 rounded p-1 text-faint hover:text-muted"
                title={t(language, 'closeSideTabs')}
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* File search modal */}
      <FileSearch isOpen={fileSearchOpen} onClose={toggleFileSearch} />
    </div>
  )
}

function ToolbarButton({
  icon,
  active,
  onClick,
  title,
  label,
  disabled = false,
}: {
  icon: React.ReactNode
  active: boolean
  onClick: () => void
  title: string
  label?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label || title}
      aria-pressed={active}
      className={clsx(
        'flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-accent-fg disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'bg-card text-primary'
          : 'hover:bg-highlight text-muted hover:text-primary'
      )}
      title={title}
    >
      {icon}
      {label && <span className="hidden @min-[680px]:inline">{label}</span>}
    </button>
  )
}
