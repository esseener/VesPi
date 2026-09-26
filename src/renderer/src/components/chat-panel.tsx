import { useAppStore } from '../store'
import { agentEngineLabel } from '../../../shared/agent-engine-label'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import { pickEmptyChatSuggestions } from '../empty-chat-suggestions'
import { ChatInput } from './chat-input'
import { GoalStrip } from './goal-strip'
import { SubagentStrip } from './subagent-strip'

import { ChatProjectPicker } from './chat-project-picker'
import { CouncilPanels } from './council-panels'
import { MessageBubble, ToolGroupBubble } from './message-bubble'
import { ActiveStreamingBubble } from './streaming-bubble'
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
import { shouldHideComposer } from '../scroll-follow'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { clsx } from 'clsx'
import vespiCenterLogo from '../assets/vespi-center-logo.png'
import {
  LayoutPanelLeft,
  X,
} from 'lucide-react'

// Fallback padding when the composer has not measured yet (~idle pill + gradient).
const DEFAULT_COMPOSER_PAD_PX = 144

export function ChatPanel(): React.JSX.Element {
  const messages = useAppStore((state) => state.messages)
  const sessionLoading = useAppStore((state) => state.sessionLoading)
  const isStreaming = useAppStore((state) => state.isStreaming)
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
  // NOTE: streamingContent/streamingThinking/streamingToolCalls are deliberately
  // NOT subscribed here — ActiveStreamingBubble subscribes them itself so a
  // per-token update only re-renders that subtree, not the whole message list.
  const piStatus = useAppStore((state) => state.piStatus)
  const engineLabel = useAppStore((state) => agentEngineLabel(state.piEngine) ?? 'Pi')
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const activeWorkspace = useAppStore((state) => state.activeWorkspace)
  const activeSessionRuntimeId = useAppStore((state) => state.activeSessionRuntimeId)
  const sessionState = useAppStore((state) => state.sessionState)

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
  /**
   * Whether the floating composer should be out of the way.
   *
   * Both conditions must hold: the transcript is scrolled away from the bottom
   * (so the composer is covering text the user is reading), and the composer is
   * not holding anything they would lose — see `composerHasUserWork`, published
   * by ChatInput. Requiring both is what makes "scroll up to read, scroll back
   * down to type" work without ever hiding an in-progress draft.
   */
  const composerHasUserWork = useAppStore((state) => state.composerHasUserWork)
  const composerHidden = shouldHideComposer({ detached: !atBottom, hasUserWork: composerHasUserWork })

  // In-conversation search (Ctrl/Cmd+F while in chat). The nonce bumps on every
  // press so re-triggering refocuses/selects the already-open input.
  const [searchOpen, setSearchOpen] = useState(false)
  const terminalOpen = useAppStore((state) => state.terminalOpen)
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
  const sidePanelMounted = showSidePanel || browserUrl !== null
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
          {/* Chrome is intentionally minimal: workspace lives in the top tabs,
              terminal owns the body. Only the side-panel toggle remains. */}
          <div className="flex h-7 items-center justify-end border-b border-border/60 px-2">
            <div className="flex shrink-0 items-center gap-px">
              <ToolbarButton
                icon={<LayoutPanelLeft size={13} />}
                active={showSidePanel}
                onClick={() => (showSidePanel ? closeSidePanel() : void setSidePanel('picker'))}
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
            {/* 唯一交互面：OMP TUI + 会打进 TUI 的命令条 */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <TerminalPanel className="flex-1" />
            </div>
          </div>
        </div>

        {/* Side panel */}
        {sidePanelMounted && (
          <div
            className={clsx('relative flex border-l border-border bg-app', !showSidePanel && 'hidden')}
            style={{ width: sidePanelContentWidth }}
          >
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
              {browserUrl !== null && (
                <div className={clsx('min-w-0 flex-1 overflow-hidden', !showBrowser && 'hidden')}>
                  <BrowserPanel url={browserUrl} nonce={browserNonce} />
                </div>
              )}
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
                onClick={closeSidePanel}
                className="absolute top-1 right-1 z-10 rounded p-1 text-faint hover:text-muted"
                title={t(language, 'openSideTabs')}
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



/** OMP TUI 常用命令（显示中文，回车发原文）。 */
const OMP_SLASH: Array<{ cmd: string; zh: string }> = [
  { cmd: '/help', zh: '帮助' },
  { cmd: '/model', zh: '切换模型' },
  { cmd: '/models', zh: '模型列表' },
  { cmd: '/think', zh: '思考档位' },
  { cmd: '/compact', zh: '压缩上下文' },
  { cmd: '/new', zh: '新会话' },
  { cmd: '/resume', zh: '恢复会话' },
  { cmd: '/fork', zh: '分支 / 分叉' },
  { cmd: '/sessions', zh: '会话列表' },
  { cmd: '/skills', zh: '技能' },
  { cmd: '/mcp', zh: '外部工具 MCP' },
  { cmd: '/config', zh: '配置 / 设置' },
  { cmd: '/settings', zh: '设置' },
  { cmd: '/login', zh: '登录供应商' },
  { cmd: '/cost', zh: '费用 / 用量' },
  { cmd: '/stats', zh: '统计' },
  { cmd: '/status', zh: '状态' },
  { cmd: '/export', zh: '导出' },
  { cmd: '/diff', zh: '查看改动' },
  { cmd: '/review', zh: '审查' },
  { cmd: '/plan', zh: '计划模式' },
  { cmd: '/undo', zh: '撤销' },
  { cmd: '/clear', zh: '清屏' },
  { cmd: '/doctor', zh: '诊断' },
  { cmd: '/version', zh: '版本' },
  { cmd: '/update', zh: '更新 OMP' },
  { cmd: '/quit', zh: '退出' },
]

/** 底部唯一输入：打进 OMP TUI；`/` 弹出中文命令面板。 */
function OmpCommandBar(): React.JSX.Element {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const [value, setValue] = useState('')
  const [active, setActive] = useState(0)
  const slashOpen = value.startsWith('/') && !value.includes(' ')
  const slashList = (() => {
    if (!value.startsWith('/')) return OMP_SLASH
    const q = value.slice(1).toLowerCase()
    if (!q) return OMP_SLASH
    return OMP_SLASH.filter((item) => item.cmd.slice(1).includes(q) || item.zh.includes(value.slice(1)))
  })()

  const send = (text: string) => {
    const out = text.trim()
    if (!out) return
    window.piDesktop.terminal.input(out.endsWith('\r') ? out : out + '\r')
    setValue('')
  }

  return (
    <div className="relative shrink-0 border-t border-border bg-surface px-3 py-2">
      {slashOpen && slashList.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 z-30 mb-2 max-h-72 overflow-y-auto rounded-xl border border-border-strong bg-elevated shadow-xl">
          <div className="border-b border-border px-3 py-1.5 text-[11px] text-dim">
            {t(language, 'ompSlashHint')}
          </div>
          {slashList.map((item, i) => (
            <button
              key={item.cmd}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => send(item.cmd)}
              className={clsx(
                'flex w-full items-center gap-3 px-3 py-2 text-left',
                i === active ? 'bg-accent-bg' : 'hover:bg-surface-hover'
              )}
            >
              <span className="w-24 shrink-0 font-jetbrains text-xs text-accent-fg">{item.cmd}</span>
              <span className="text-sm text-primary">{item.zh}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex w-full items-center gap-2">
        <span className="font-jetbrains text-[11px] text-accent-fg">OMP</span>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (slashOpen && slashList.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => Math.min(i + 1, slashList.length - 1))
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => Math.max(i - 1, 0))
                return
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                e.preventDefault()
                const pick = slashList[active]
                if (pick) send(pick.cmd)
                return
              }
              if (e.key === 'Escape') {
                setValue('')
                return
              }
            }
            if (e.key === 'Enter' && value.trim()) {
              send(value)
            }
          }}
          placeholder={t(language, 'ompCommandPlaceholder')}
          className="h-9 flex-1 rounded-full border border-border-strong bg-app px-3 text-sm outline-none focus:border-accent"
        />
        <span className="font-jetbrains text-[10px] text-dim">Enter → OMP</span>
      </div>
    </div>
  )
}
