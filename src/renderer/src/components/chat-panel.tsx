import { useAppStore } from '../store'
import { agentEngineLabel } from '../../../shared/agent-engine-label'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import { pickEmptyChatSuggestions } from '../empty-chat-suggestions'
import { ChatInput } from './chat-input'

import { ChatProjectPicker } from './chat-project-picker'
import { CouncilPanels } from './council-panels'
import { MessageBubble, ToolGroupBubble } from './message-bubble'
import { StreamingBubble } from './streaming-bubble'
import { ChatSearch } from './chat-search'
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

import { groupToolMessages, prepareChatMessages } from '../message-grouping'
import { NowContext } from '../utils/relative-time'
import { FileTree, FileSearch, FilePreview } from './file-tree'
import { ImageViewer } from './image-viewer'
import { DiffViewer } from './diff-viewer'
import { TerminalPanel } from './terminal'
import { BrowserPanel } from './browser-panel'
import { SideTabPicker } from './side-tab-picker'
import { ReviewRail } from './review-rail'
import { useChatScroll, useGlobalWorkflowOpen } from '../hooks'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { clsx } from 'clsx'
import vespiCenterLogo from '../assets/vespi-center-logo.png'
import {
  FolderTree,
  GitCompare,
  Globe,
  LayoutPanelLeft,
  ShieldCheck,
  SquareTerminal,
  X,
  ChevronDown,
} from 'lucide-react'

// Fallback padding when the composer has not measured yet (~idle pill + gradient).
const DEFAULT_COMPOSER_PAD_PX = 144

export function ChatPanel(): React.JSX.Element {
  const messages = useAppStore((state) => state.messages)
  const sessionLoading = useAppStore((state) => state.sessionLoading)
  const isStreaming = useAppStore((state) => state.isStreaming)
  const reattachedMidTurn = useAppStore((state) => state.reattachedMidTurn)
  const composerWrapRef = useRef<HTMLDivElement>(null)
  const [composerPadPx, setComposerPadPx] = useState(DEFAULT_COMPOSER_PAD_PX)

  // Drive message-list bottom padding from the real floating composer height so
  // a tall draft / attachments row never permanently covers the last message.
  useEffect(() => {
    const el = composerWrapRef.current
    if (!el) return
    const measure = (): void => {
      setComposerPadPx(Math.max(el.offsetHeight, DEFAULT_COMPOSER_PAD_PX))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const streamingContent = useAppStore((state) => state.streamingContent)
  const streamingThinking = useAppStore((state) => state.streamingThinking)
  const streamingToolCalls = useAppStore((state) => state.streamingToolCalls)
  const piStatus = useAppStore((state) => state.piStatus)
  const engineLabel = useAppStore((state) => agentEngineLabel(state.piEngine) ?? 'Pi')
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const activeWorkspace = useAppStore((state) => state.activeWorkspace)
  const activeSessionRuntimeId = useAppStore((state) => state.activeSessionRuntimeId)
  const sessionState = useAppStore((state) => state.sessionState)

  const reviewOpen = useAppStore((state) => state.reviewOpen)
  const terminalOpen = useAppStore((state) => state.terminalOpen)
  const previewTarget = useAppStore((state) => state.previewTarget)
  const fileSearchOpen = useAppStore((state) => state.fileSearchOpen)
  const toggleFileSearch = useAppStore((state) => state.toggleFileSearch)

  // sidePanel lives in the store so it survives view switches (e.g. Settings
  // round-trip). Widths stay local — resetting them on remount is benign.
  const sidePanel = useAppStore((state) => state.chatSidePanel)
  const setSidePanel = useAppStore((state) => state.setChatSidePanel)
  const [sidePanelWidth, setSidePanelWidth] = useState(DEFAULT_SIDE_PANEL_WIDTH)
  const [filePaneWidth, setFilePaneWidth] = useState(DEFAULT_FILE_PANE_WIDTH)

  // One shared clock for all relative-time labels — refresh every 30s so
  // "5 minutes ago" stays current without each label owning a timer.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const currentView = useAppStore((state) => state.currentView)
  // The global workflow view replaces the main pane while this panel stays
  // mounted behind `display: none`, so "chat is on screen" needs both checks.
  // Without the second one the scroll hook never sees the hidden→shown edge and
  // cannot re-anchor the reading position when the workflow view closes.
  const globalWorkflowOpen = useGlobalWorkflowOpen()
  const chatVisible = currentView === 'chat' && !globalWorkflowOpen
  const { scrollRef, onScroll, atBottom, scrollToBottom } = useChatScroll(chatVisible)

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

  // Fold consecutive tool-call/result runs into collapsed groups. Memoized so
  // the grouping only recomputes when the message list changes, and so lone
  // MessageBubbles keep their stable refs (no markdown re-parse on re-render).
  const renderItems = useMemo(() => groupToolMessages(prepareChatMessages(messages)), [messages])
  const emptyChatSuggestions = useMemo(
    () => pickEmptyChatSuggestions({
      language,
      seed: activeSessionRuntimeId ?? sessionState?.sessionFile ?? activeWorkspace?.id ?? 'empty',
      workspacePath: activeWorkspace?.path,
    }),
    [language, activeSessionRuntimeId, sessionState?.sessionFile, activeWorkspace?.id, activeWorkspace?.path],
  )

  const handleRetry = useCallback(async (messageId: string) => {
    // Read from the store so this callback stays referentially stable, keeping
    // the memoized MessageBubble list from re-rendering when messages change.
    const { messages: current, sendPrompt } = useAppStore.getState()
    const msg = current.find((m) => m.id === messageId)
    if (msg?.role === 'user') {
      await sendPrompt(msg.content)
    }
  }, [])

  const showPicker = sidePanel === 'picker'
  const showSidePanel = showPicker || sidePanel !== null || previewTarget !== null
  const showFileTree = sidePanel === 'files'
  const showImage = previewTarget?.kind === 'image' && sidePanel !== 'diff'
  const showEditor = previewTarget?.kind === 'code' && sidePanel !== 'diff'
  const showDiff = sidePanel === 'diff'
  const showReview = sidePanel === 'review'
  const showBrowser = sidePanel === 'browser'
  const {
    fileTreeOnly: showFileTreeOnly,
    minSidePanelWidth,
    contentWidth: sidePanelContentWidth,
    filePaneWidth: effectiveFilePaneWidth,
    maxFilePaneWidth,
  } = resolveSidePanelMetrics({ showFileTree, showEditor, showImage }, sidePanelWidth, filePaneWidth)

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Main chat area */}
        <div className="chat-center flex flex-1 flex-col overflow-hidden">
          {/* Toolbar: path + view toggles. Sidebar/terminal live in status bar. */}
          <div className="flex h-8 items-center justify-between border-b border-border px-2">
            <div className="flex min-w-0 items-center gap-2">
              {activeWorkspace && (
                <div className="flex min-w-0 items-center gap-1.5 border border-border px-1.5 py-0.5" title={activeWorkspace.path}>
                  <FolderTree size={12} className="shrink-0 text-secondary" />
                  <span className="truncate font-jetbrains text-[11px] text-secondary">
                    {activeWorkspace.path}
                  </span>
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-px">
              <ToolbarButton
                icon={<LayoutPanelLeft size={13} />}
                active={showSidePanel}
                onClick={() => void setSidePanel(showSidePanel ? null : 'picker')}
                title={showSidePanel ? t(language, 'closeSideTabs') : t(language, 'openSideTabs')}
              />
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col">
            {searchOpen && (
              <ChatSearch
                containerRef={scrollRef}
                focusNonce={searchNonce}
                onClose={() => setSearchOpen(false)}
              />
            )}
            {(() => {
              const isEmptyChat =
                !sessionLoading && messages.length === 0 && !isStreaming

              // Empty session: Codex-style center prompt + project picker (sidebar chrome).
              if (isEmptyChat) {
                return (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-10">
                    <div className="mb-8 text-center">
                      <img
                        src={vespiCenterLogo}
                        alt={t(language, 'appName')}
                        draggable={false}
                        className="mx-auto mb-4 block h-32 w-auto max-w-[40rem]"
                      />
                      <p className="text-sm text-dim">
                        {piStatus === 'error'
                          ? t(language, 'failedStartCheckSettings', { engine: engineLabel })
                          : piStatus === 'stopped'
                            ? t(language, 'chooseProjectStartsOnSend')
                            : t(language, 'pickProjectDescribe')}
                      </p>
                    </div>
                    <div className="w-full max-w-3xl">
                      {piStatus !== 'error' && (
                        <div className="mb-4 flex flex-wrap justify-center gap-2 px-4">
                          {emptyChatSuggestions.map((prompt) => (
                            <button
                              key={prompt}
                              type="button"
                              onClick={() => {
                                useAppStore.getState().insertPrompt(prompt, true)
                              }}
                              className="rounded-lg border border-border-strong px-3 py-1.5 text-xs text-muted hover:border-border-strong-hover hover:text-secondary transition-colors"
                            >
                              {prompt}
                            </button>
                          ))}
                        </div>
                      )}
                      <ChatInput />
                      <div className="px-4">
                        <ChatProjectPicker />
                      </div>
                    </div>
                  </div>
                )
              }

              return (
                <>
                  <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
                    {sessionLoading && messages.length === 0 ? (
                      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-dim">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
                        {piStatus === 'running' ? t(language, 'startingAgent', { engine: engineLabel }) : t(language, 'startingAgent', { engine: engineLabel })}

                      </div>
                    ) : (
                      <NowContext.Provider value={now}>
                        <div
                          className="mx-auto max-w-5xl px-4 pt-6"
                          style={{ paddingBottom: composerPadPx }}
                        >
                          {renderItems.map((item) =>
                            item.kind === 'toolGroup' ? (
                              <ToolGroupBubble
                                key={item.id}
                                title={item.title}
                                messages={item.messages}
                                onRetry={handleRetry}
                              />
                            ) : (
                              <MessageBubble
                                key={item.message.id}
                                message={item.message}
                                onRetry={handleRetry}
                              />
                            )
                          )}
                          {isStreaming && (
                            <StreamingBubble
                              content={streamingContent}
                              thinking={streamingThinking}
                              toolCalls={streamingToolCalls}
                            />
                          )}
                        </div>
                      </NowContext.Provider>
                    )}
                  </div>

                  {!atBottom && (
                    <button
                      onClick={scrollToBottom}
                      className="absolute left-1/2 z-20 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-border-strong bg-card/90 text-secondary shadow-lg shadow-black/30 backdrop-blur transition-colors hover:bg-elevated hover:text-primary"
                      style={{ bottom: composerPadPx + 12 }}
                      title={t(language, 'scrollToBottom')}
                      aria-label={t(language, 'scrollToBottom')}
                    >
                      <ChevronDown size={16} />
                    </button>
                  )}


                  <div
                    ref={composerWrapRef}
                    className="pointer-events-none absolute inset-x-0 bottom-0 z-10 pb-3 pt-8 bg-gradient-to-t from-chat-column via-chat-column/80 to-transparent"
                  >
                    <div className="pointer-events-auto mx-auto w-full max-w-5xl px-4">
                      <CouncilPanels />
                    </div>
                    {reattachedMidTurn && (
                      <div className="pointer-events-auto mx-auto mb-2 w-full max-w-5xl px-4">
                        <div className="flex items-center gap-2.5 rounded-sm border border-border-strong bg-transparent px-4 py-2.5 text-sm text-primary">
                          <span className="run-silver h-3 w-3 shrink-0 rounded-full" aria-hidden="true" />
                          <span className="shrink-0 font-medium">still working</span>
                          <span className="min-w-0 flex-1 truncate text-dim">
                            The response appears here the moment it finishes.
                          </span>
                        </div>
                      </div>
                    )}
                    <ChatInput />
                  </div>
                </>
              )
            })()}
          </div>
        </div>

        {/* Side panel */}
        {showSidePanel && (
          <div className="relative flex border-l border-border bg-app" style={{ width: sidePanelContentWidth }}>
            <ResizeHandle
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
            />
            <div className="flex min-w-0 flex-1 overflow-hidden">
              {showPicker && <SideTabPicker />}
              {showReview && <ReviewRail embedded />}
              {showBrowser && <BrowserPanel />}
              {showFileTree && (
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
                    showFileTree && 'border-l border-border'
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
                onClick={() => void setSidePanel(null)}
                className="absolute top-1 right-1 z-10 rounded p-1 text-faint hover:text-muted"
                title={t(language, 'openSideTabs')}
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Terminal panel */}
      <TerminalPanel />

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
}: {
  icon: React.ReactNode
  active: boolean
  onClick: () => void
  title: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded p-1 transition-colors',
        active
          ? 'bg-card text-primary'
          : 'hover:bg-highlight text-dim hover:text-secondary'
      )}
      title={title}
    >
      {icon}
    </button>
  )
}

