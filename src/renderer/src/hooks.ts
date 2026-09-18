import { useEffect, useLayoutEffect, useMemo, useRef, useCallback, useState } from 'react'
import { useAppStore } from './store'
import { shouldFollowContent, shouldFollowStream } from './scroll-follow'
import { DEFAULT_SETTINGS } from '../../shared/default-settings'
import { hasConfiguredChatModel } from '../../shared/models-config'
import { BUILTIN_SOURCE, type PiCommand } from '../../shared/pi-command'
import type { WorkspaceActivationIntent } from '../../shared/ipc-contracts'
import { DEFAULT_LANGUAGE, t } from '../../shared/i18n'
import { playCompletionChime } from './completion-chime'

/**
 * Subscribes to Pi events from the main process and routes them to the store.
 * Must be called once in the top-level component tree.
 */
export function usePiEvents(): void {
  const handlePiEvent = useAppStore((state) => state.handlePiEvent)
  const handlePendingPromptCounts = useAppStore((state) => state.handlePendingPromptCounts)
  const handleWorkspaceActivity = useAppStore((state) => state.handleWorkspaceActivity)
  const handleSessionRuntime = useAppStore((state) => state.handleSessionRuntime)
  const recoverPendingPrompts = useAppStore((state) => state.recoverPendingPrompts)
  const lastChimeAt = useRef(useAppStore.getState().completionChimeAt)

  useEffect(() => {
    return useAppStore.subscribe((state) => {
      if (state.completionChimeAt !== lastChimeAt.current && state.completionChimeAt > 0) {
        lastChimeAt.current = state.completionChimeAt
        // Read the settings at play time so a change applies immediately without
        // re-subscribing. An older settings file has no `completionChime`, and an
        // absent flag means enabled — the chime existed before the setting did.
        const settings = useAppStore.getState().settings
        if (settings?.completionChime !== false) playCompletionChime(settings?.completionChimeVolume)
      }
    })
  }, [])
  useEffect(() => {
    // Subscribe to Pi events (status changes arrive here too, as 'status_change').
    const unsubscribeEvent = window.piDesktop.onEvent(handlePiEvent)
    const unsubscribeCounts = window.piDesktop.onPendingPrompts(handlePendingPromptCounts)
    const unsubscribeActivity = window.piDesktop.onWorkspaceActivity(handleWorkspaceActivity)
    const unsubscribeSessionRuntime = window.piDesktop.onSessionRuntime(handleSessionRuntime)
    const unsubscribeKernelProgress = window.piDesktop.updates.onKernelProgress(
      useAppStore.getState().handleKernelUpdateProgress,
    )
    const unsubscribeUiProgress = window.piDesktop.updates.onUiProgress(
      useAppStore.getState().handleUiUpdateProgress,
    )

    // A desktop-notification click hands the renderer the switch intent so the
    // usual streaming/dirty-editor confirms still run; landing on chat shows
    // the finished (or waiting) turn the notification was about.
    const activateWorkspaceIntent = (intent: WorkspaceActivationIntent): void => {
      const state = useAppStore.getState()
      const { workspaceId, sessionPath } = intent
      // A stale intent for a removed workspace must not run confirm dialogs
      // for a doomed switch. An empty list means it just hasn't loaded yet
      // (boot) — proceed and let main validate.
      if (state.workspaces.length > 0 && !state.workspaces.some((ws) => ws.id === workspaceId)) return

      void (async () => {
        if (sessionPath) {
          if (state.activeWorkspace?.id !== workspaceId) {
            if (!(await state.activateWorkspace(workspaceId, { awaitingSession: true }))) return
          }
          const workspace = useAppStore.getState().activeWorkspace
          if (!workspace) return
          await useAppStore.getState().switchSession(sessionPath, workspace.path)
          useAppStore.getState().setCurrentView('chat')
          return
        }
        if (state.activeWorkspace?.id === workspaceId) {
          if (state.currentView !== 'chat') state.setCurrentView('chat')
          return
        }
        const switched = await state.activateWorkspace(workspaceId)
        if (switched) useAppStore.getState().setCurrentView('chat')
      })()
    }
    const unsubscribeActivate = window.piDesktop.onActivateWorkspace((intent) => {
      // Main stashes every click's intent in case this broadcast never lands
      // (boot/reload race). It did land — consume the stash so a later boot
      // cannot replay a long-stale activation.
      void window.piDesktop.workspace.takePendingActivation().catch(() => undefined)
      activateWorkspaceIntent(intent)
    })

    // A reload leaves the dialog slot empty while main still holds the prompt.
    void recoverPendingPrompts()

    // A notification clicked while no window existed stashed its intent in
    // main; deliver it now that the subscriptions above are live.
    void window.piDesktop.workspace
      .takePendingActivation()
      .then((intent) => {
        if (intent) activateWorkspaceIntent(intent)
      })
      .catch(() => {
        // Non-fatal: the user can switch manually.
      })

    return () => {
      unsubscribeEvent()
      unsubscribeCounts()
      unsubscribeActivity()
      unsubscribeSessionRuntime()
      unsubscribeKernelProgress()
      unsubscribeUiProgress()
      unsubscribeActivate()
    }
  }, [handlePiEvent, handlePendingPromptCounts, handleWorkspaceActivity, handleSessionRuntime, recoverPendingPrompts])
}

/**
 * Subscribes to menu actions from the application menu.
 */
export function useMenuActions(): void {
  const createNewSession = useAppStore((state) => state.createNewSession)
  const setCurrentView = useAppStore((state) => state.setCurrentView)

  useEffect(() => {
    const unsubscribe = window.piDesktop.onMenuAction((action) => {
      switch (action) {
        case 'menu:new-session':
          createNewSession()
          break
        case 'menu:new-workspace':
          setCurrentView('settings') // Open settings where workspace creation lives
          break
        case 'menu:open-project': {
          void window.piDesktop.system.openDialog({ title: 'Open Project' }).then((path) => {
            if (path) void useAppStore.getState().openFolderAsWorkspace(path)
          })
          break
        }
      }
    })

    return unsubscribe
  }, [createNewSession, setCurrentView])
}

/**
 * The workflow navigator's scope, as the store holds it. Structural so the
 * predicate below can be exercised without building a whole store state.
 */
interface WorkflowPanelScope {
  workflowPanelOpen: boolean
  workflowPanelFilter: string | null
  workflowPanelWorkspaceId: string | null
}

/**
 * Whether the global "All Workflows" surface owns the main pane — the navigator
 * opened with neither a session nor a project scope. Session-scoped and
 * project-scoped runs render in the docked panel instead and leave the current
 * view on screen. Shared so every consumer (main pane, workspace tabs, sidebar,
 * chat scroll) agrees on what "global" means.
 */
export function isGlobalWorkflowOpen(scope: WorkflowPanelScope): boolean {
  return (
    scope.workflowPanelOpen && !scope.workflowPanelFilter && scope.workflowPanelWorkspaceId === null
  )
}

/** Component-side subscription to {@link isGlobalWorkflowOpen}. */
export function useGlobalWorkflowOpen(): boolean {
  return useAppStore(isGlobalWorkflowOpen)
}

// Distance (px) from the bottom within which we consider the user "at bottom"
// and keep following new content.
const AT_BOTTOM_THRESHOLD = 48

// A content-relative scroll position. We store this instead of a raw scrollTop
// so the reading spot survives content-height changes that happen while the chat
// is hidden — chiefly toggling Show Thinking in Settings, which shows/hides every
// thinking block. A raw scrollTop would then point at different content.
type ScrollAnchor =
  | { kind: 'bottom' }
  // Preserve distance from the bottom. Used when no prose is on screen to anchor
  // against (e.g. the viewport shows only tool boxes).
  | { kind: 'fromBottom'; distanceFromBottom: number }
  // `id` identifies a message's *text body* (the `data-scroll-anchor` marker on
  // assistant text / user messages — never on tool boxes or thinking blocks).
  // `viewportOffset` is its top edge relative to the container's top (often
  // negative — it starts above the fold). Anchoring to the prose the reader is
  // actually looking at — below any thinking block, even one in the same message
  // — means collapsing thinking above it doesn't shift it. `distanceFromBottom`
  // is a last-resort fallback if the element is somehow gone on restore.
  | { kind: 'body'; id: string; viewportOffset: number; distanceFromBottom: number }

// Snapshot the current reading position of the scroll container.
function captureAnchor(el: HTMLElement): ScrollAnchor {
  const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop
  if (distanceFromBottom <= AT_BOTTOM_THRESHOLD) return { kind: 'bottom' }
  const containerTop = el.getBoundingClientRect().top
  const nodes = el.querySelectorAll<HTMLElement>('[data-scroll-anchor]')
  for (const node of nodes) {
    const rect = node.getBoundingClientRect()
    // First text body whose bottom edge is below the container's top — i.e. the
    // topmost at least partially visible piece of prose.
    if (rect.bottom > containerTop) {
      return {
        kind: 'body',
        id: node.dataset.scrollAnchor as string,
        viewportOffset: rect.top - containerTop,
        distanceFromBottom,
      }
    }
  }
  return { kind: 'fromBottom', distanceFromBottom }
}

// Restore a previously captured anchor, absorbing any height change above it.
function restoreAnchor(el: HTMLElement, anchor: ScrollAnchor): void {
  if (anchor.kind === 'bottom') {
    el.scrollTop = el.scrollHeight
    return
  }
  if (anchor.kind === 'fromBottom') {
    el.scrollTop = el.scrollHeight - el.clientHeight - anchor.distanceFromBottom
    return
  }
  const node = el.querySelector<HTMLElement>(`[data-scroll-anchor="${CSS.escape(anchor.id)}"]`)
  if (!node) {
    el.scrollTop = el.scrollHeight - el.clientHeight - anchor.distanceFromBottom
    return
  }
  const containerTop = el.getBoundingClientRect().top
  const currentOffset = node.getBoundingClientRect().top - containerTop
  el.scrollTop += currentOffset - anchor.viewportOffset
}

/**
 * Manages the chat scroll container:
 *  - remembers each session's scroll offset and restores it when you switch back
 *  - follows new/streamed content (a new prompt or live tokens) while Auto Scroll
 *    is enabled; leaves the position alone when it's off
 *  - jumps to the bottom when `chatScrollBottomNonce` changes (Home resume)
 *
 * `active` is whether the chat view is currently visible; while hidden the panel
 * stays mounted (so scrollTop persists) but we defer any scrolling until it's
 * shown again, so measurements are valid.
 */
export function useChatScroll(active: boolean): {
  scrollRef: React.RefObject<HTMLDivElement | null>
  onScroll: () => void
  atBottom: boolean
  scrollToBottom: () => void
} {
  const ref = useRef<HTMLDivElement>(null)
  const autoScroll = useAppStore(
    (state) => state.settingsDraft.autoScroll ?? state.settings?.autoScroll ?? DEFAULT_SETTINGS.autoScroll
  )
  const sessionId = useAppStore((state) => state.sessionState?.sessionId ?? null)
  const messages = useAppStore((state) => state.messages)
  // streamingContent is deliberately NOT hook-subscribed: it changes on every
  // token, and this hook runs inside ChatPanel, so subscribing would re-render
  // the whole message list per token. It is tracked imperatively below instead.
  const scrollBottomNonce = useAppStore((state) => state.chatScrollBottomNonce)
  // Whether the session on screen is still writing. Switching to (or back to) a
  // session mid-answer has to show the tail and keep following it, rather than
  // restoring a reading position captured before the turn moved on.
  const sessionIsStreaming = useAppStore((state) => state.isStreaming)

  const positions = useRef<Map<string, ScrollAnchor>>(new Map())
  const activeSession = useRef<string | null>(null)
  const seenNonce = useRef(scrollBottomNonce)
  const forceBottom = useRef(false)
  // Whether the chat was visible on the previous run, so we can re-anchor when it
  // becomes visible again (e.g. returning from Settings after toggling thinking).
  const prevActive = useRef(false)
  // While a just-switched session's messages are still loading (async), keep
  // re-applying the target scroll until content is actually present.
  const pendingRestore = useRef(false)
  // Track content size to distinguish genuinely new content from unrelated
  // re-renders (e.g. re-showing the panel), so returning to chat doesn't scroll.
  const prevMsgCount = useRef(0)
  const prevStreamLen = useRef(0)
  // Mirrors for the imperative streaming subscription (store listeners don't
  // see hook-scope values).
  const activeRef = useRef(active)
  activeRef.current = active
  const autoScrollRef = useRef(autoScroll)
  autoScrollRef.current = autoScroll
  // Mirror for the layout effect, which must read the current value rather than
  // the one captured when the effect was defined.
  const streamingRef = useRef(sessionIsStreaming)
  streamingRef.current = sessionIsStreaming

  // Whether the viewport is at (or within a hair of) the bottom. `atBottom` (state)
  // drives the jump-to-bottom button; `atBottomRef` is read synchronously in the
  // layout effect to decide whether streamed content should keep following.
  const [atBottom, setAtBottom] = useState(true)
  const atBottomRef = useRef(true)

  // Whether the user has deliberately scrolled away from the bottom. This — not
  // the instantaneous at-bottom measurement — is what the follower keys off.
  //
  // The measurement can turn false without anybody scrolling: content that grows
  // after we positioned the view (a late-loading image, a reflowing markdown
  // block, a notice appended right behind the prompt) leaves the viewport above
  // the new bottom, and the follower then sat out the rest of the turn. The
  // answer only showed up once the user nudged the view back down — "I had to
  // scroll a bit before new output appeared again". A flag that only a real
  // scroll sets cannot be falsified that way; forced scrolls and sends clear it.
  const userDetached = useRef(false)

  // Recompute at-bottom from the live DOM and publish it to both the ref and the
  // button state (setState no-ops when unchanged, so this is cheap to call often).
  const syncAtBottom = useCallback(() => {
    const el = ref.current
    if (!el) return
    const next = el.scrollHeight - el.clientHeight - el.scrollTop <= AT_BOTTOM_THRESHOLD
    atBottomRef.current = next
    setAtBottom(next)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    userDetached.current = false
    setAtBottom(true)
  }, [])

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    const scrollable = el.scrollHeight - el.clientHeight
    // Only remember a position while there's a real scroll range — avoids
    // clobbering the saved offset with 0 when messages are momentarily cleared
    // during a session switch.
    if (activeSession.current !== null && scrollable > AT_BOTTOM_THRESHOLD) {
      positions.current.set(activeSession.current, captureAnchor(el))
    }
    const next = scrollable - el.scrollTop <= AT_BOTTOM_THRESHOLD
    atBottomRef.current = next
    // A real scroll event is the only thing that may stop the follow: reaching the
    // bottom resumes it, leaving the bottom suspends it.
    userDetached.current = !next
    setAtBottom(next)
  }, [])

  // Imperative streaming tracker: keeps prevStreamLen current (even while the
  // panel is hidden) and follows the stream tail — all without re-rendering
  // the host component per token. Store listeners run before React commits
  // the new DOM, so the actual scroll defers to the next animation frame.
  useEffect(() => {
    return useAppStore.subscribe((state) => {
      const len = state.streamingContent.length
      const grew = len > prevStreamLen.current
      prevStreamLen.current = len
      if (!grew) return
      // Streamed text is arriving, which is exactly the content a pending
      // restore was waiting for. It cannot clear itself: the layout effect only
      // re-runs when `messages` changes, and a mid-turn attach has no committed
      // messages to change — the kernel withholds a running turn. Left set, it
      // vetoed this follower for the whole turn, so the chat sat parked at its
      // old offset and the answer only appeared once the turn ended and
      // committed in one piece. The restore already positioned the view on its
      // own pass, so release both gates here — including the forced jump, whose
      // layout pass runs before this animation frame.
      pendingRestore.current = false
      forceBottom.current = false
      const shouldFollow = (): boolean =>
        shouldFollowStream({
          autoScroll: autoScrollRef.current,
          active: activeRef.current,
          userDetached: userDetached.current,
        })
      if (!shouldFollow()) return
      requestAnimationFrame(() => {
        const el = ref.current
        if (!el) return
        if (!shouldFollow()) return
        el.scrollTop = el.scrollHeight
        syncAtBottom()
      })
    })
  }, [syncAtBottom])

  useLayoutEffect(() => {
    const el = ref.current

    // Did the message list actually grow (new message)? Tracked even while
    // hidden so re-showing the panel isn't mistaken for new content. Streamed
    // text growth is handled by the imperative subscription above.
    const messagesGrew = messages.length > prevMsgCount.current
    const grew = messagesGrew
    prevMsgCount.current = messages.length

    // Defer scrolling while hidden: a display:none element has no layout, so
    // scrollHeight is 0 and any positioning would be wrong.
    if (!el || !active) {
      prevActive.current = active
      return
    }

    const becameActive = !prevActive.current
    prevActive.current = active

    if (scrollBottomNonce !== seenNonce.current) {
      seenNonce.current = scrollBottomNonce
      forceBottom.current = true
    }

    const sessionKey = sessionId ?? '__none__'
    if (activeSession.current !== sessionKey) {
      activeSession.current = sessionKey
      pendingRestore.current = true
    }

    if (pendingRestore.current) {
      const saved = positions.current.get(sessionKey)
      // A session that is still writing shows its tail. The saved anchor is from
      // before this turn produced output, so restoring it parked the view up in
      // the history with the live text below the fold — and that restore then
      // counted as "the user scrolled away", which switched the follower off
      // until the user scrolled down by hand.
      const followLiveTurn = streamingRef.current || forceBottom.current
      if (followLiveTurn || saved === undefined) {
        el.scrollTop = el.scrollHeight
      } else {
        restoreAnchor(el, saved)
      }
      // Consider the switch settled once there is content on screen. `messages`
      // alone is not enough: re-attaching to a session whose turn is still
      // running yields NO committed messages, because the kernel only publishes
      // them when the turn ends — the view is filled from the live-turn
      // snapshot instead. Waiting for `messages` there kept pendingRestore
      // armed for the entire turn, and the stream follower bails out while the
      // flag is set, so the chat stayed parked at its old offset while the
      // model kept writing. Streamed length counts as content too.
      if (messages.length > 0 || prevStreamLen.current > 0) {
        pendingRestore.current = false
        forceBottom.current = false
      }
      syncAtBottom()
      userDetached.current = followLiveTurn ? false : !atBottomRef.current
      return
    }

    // Returned to the chat view (e.g. from Settings) in the same session. The
    // content height may have changed while hidden — Show Thinking toggles every
    // thinking block — so re-anchor to the saved reading position rather than
    // leaving the now-stale scrollTop, which would show different content.
    if (becameActive) {
      const saved = positions.current.get(sessionKey)
      // Same rule as a session switch: a session that is still writing shows its
      // tail, and anything else goes back to where it was being read.
      const followLiveTurn = streamingRef.current || forceBottom.current
      if (followLiveTurn || saved === undefined) {
        el.scrollTop = el.scrollHeight
      } else {
        restoreAnchor(el, saved)
      }
      forceBottom.current = false
      // Refresh the jump-to-bottom button against the restored position: content
      // height may have changed while hidden (e.g. Show Thinking toggled), so the
      // stale at-bottom state would otherwise hide the chevron until the next scroll.
      syncAtBottom()
      userDetached.current = followLiveTurn ? false : !atBottomRef.current
      return
    }

    if (forceBottom.current) {
      el.scrollTop = el.scrollHeight
      forceBottom.current = false
      userDetached.current = false
      syncAtBottom()
      return
    }

    // A new user message means the user just sent a prompt — always reveal it.
    const lastIsUser = messagesGrew && messages[messages.length - 1]?.role === 'user'

    // Follow new/streamed content unless the user scrolled away to read. Auto
    // Scroll off means the view never moves on its own.
    if (shouldFollowContent({ autoScroll, grew, lastIsUser, userDetached: userDetached.current })) {
      el.scrollTop = el.scrollHeight
    }

    syncAtBottom()
  }, [active, sessionId, messages, scrollBottomNonce, autoScroll, sessionIsStreaming, syncAtBottom])

  return { scrollRef: ref, onScroll, atBottom, scrollToBottom }
}

/**
 * Keyboard shortcut handler for the chat input.
 */
export function useChatKeyboard(
  onSend: (message: string) => void,
  onAbort: () => void,
  inputRef: React.RefObject<HTMLTextAreaElement | null>
): void {
  const isStreaming = useAppStore((state) => state.isStreaming)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // IME guard: while a composition window is open (Chinese / Japanese input),
      // Enter confirms the candidate and arrows move through candidates. Those
      // keys belong to the IME, never to us. keyCode 229 is the legacy signal
      // some IMEs still emit instead of setting isComposing.
      if (e.isComposing || e.keyCode === 229) return

      // Escape: abort streaming
      if (e.key === 'Escape' && isStreaming) {
        e.preventDefault()
        onAbort()
        return
      }

      // Enter: send message (without Shift)
      if (e.key === 'Enter' && !e.shiftKey && document.activeElement === inputRef.current) {
        // A blocking extension prompt is on screen — Enter belongs to it, not to
        // the composer. Belt-and-braces with the dialog's own autoFocus.
        if (useAppStore.getState().extensionUiRequest) return
        e.preventDefault()
        const value = inputRef.current?.value.trim()
        if (value) {
          onSend(value)
          if (!isStreaming && inputRef.current) inputRef.current.value = ''
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isStreaming, onSend, onAbort, inputRef])
}

/** A Pi built-in that maps to a GUI action rather than being inserted as text. */
export interface BuiltinCommand {
  name: string
  description: string
  run: () => void
}

/**
 * The command set offered by both command UIs (Ctrl+K palette and the
 * composer's inline slash popup): everything the agent reports plus the GUI's
 * built-in actions, ready for filtering. Built-ins cover Pi commands with a
 * direct GUI equivalent; ones that need an argument or aren't supported in the
 * GUI (e.g. /name, /tree) are excluded.
 */
export function useCommandCatalog(): { builtins: BuiltinCommand[]; allCommands: PiCommand[] } {
  const commands = useAppStore((s) => s.commands)
  const language = useAppStore((s) => s.settingsDraft.language ?? s.settings?.language ?? DEFAULT_LANGUAGE)
  const compactContext = useAppStore((s) => s.compactContext)
  const cloneBranch = useAppStore((s) => s.cloneBranch)
  const createNewSession = useAppStore((s) => s.createNewSession)
  const setTaskLauncherOpen = useAppStore((s) => s.setTaskLauncherOpen)
  const setCurrentView = useAppStore((s) => s.setCurrentView)

  const builtins = useMemo<BuiltinCommand[]>(
    () => [
      { name: 'compact', description: t(language, 'cmdCompact'), run: () => { void compactContext() } },
      { name: 'clone', description: t(language, 'cmdClone'), run: () => { void cloneBranch() } },
      { name: 'new', description: t(language, 'cmdNew'), run: () => { void createNewSession() } },
      { name: 'task', description: t(language, 'cmdTask'), run: () => setTaskLauncherOpen(true) },
      { name: 'resume', description: t(language, 'cmdResume'), run: () => setCurrentView('sessions') },
      { name: 'fork', description: t(language, 'cmdFork'), run: () => setCurrentView('timeline') },
      // `fork` is the only route to the timeline, and nobody searching for
      // "timeline" or "branches" would guess to type "fork" — so the view gets
      // its own discoverable entry rather than hiding behind the verb.
      { name: 'timeline', description: t(language, 'cmdTimeline'), run: () => setCurrentView('timeline') },
      { name: 'missions', description: t(language, 'cmdMissionControl'), run: () => setCurrentView('mission-control') },
      { name: 'diagnostics', description: t(language, 'cmdDiagnostics'), run: () => setCurrentView('diagnostics') },
      { name: 'settings', description: t(language, 'cmdSettings'), run: () => setCurrentView('settings') },
    ],
    [language, compactContext, cloneBranch, createNewSession, setTaskLauncherOpen, setCurrentView]
  )

  const allCommands = useMemo<PiCommand[]>(
    () => [
      ...commands,
      ...builtins.map((b) => ({ name: b.name, description: b.description, source: BUILTIN_SOURCE })),
    ],
    [commands, builtins]
  )

  return { builtins, allCommands }
}

/**
 * How often a long-running window re-checks for a new release. GitHub allows 60
 * anonymous API requests per hour and one check costs two (GUI + kernel).
 */
const UPDATE_RECHECK_INTERVAL_MS = 30 * 60 * 1000

/**
 * Loads initial data on mount — workspaces, settings, then Pi.
 */
export function useInitialize(): void {
  const startPi = useAppStore((state) => state.startPi)
  const loadSettings = useAppStore((state) => state.loadSettings)
  const loadWorkspaces = useAppStore((state) => state.loadWorkspaces)
  const refreshSessionStats = useAppStore((state) => state.refreshSessionStats)
  const refreshSessionList = useAppStore((state) => state.refreshSessionList)

  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const initialize = async (): Promise<void> => {
      await loadSettings()
      const openToHome = useAppStore.getState().settings?.openToHomeOnLaunch ?? DEFAULT_SETTINGS.openToHomeOnLaunch

      // Workspaces are needed for the shell chrome; land the UI immediately after.
      await loadWorkspaces()
      void window.piDesktop.session.listRuntimes()
        .then((runtimes) => runtimes.forEach((runtime) => useAppStore.getState().handleSessionRuntime(runtime)))
        .catch(() => undefined)

      if (openToHome) {
        // Interactive ASAP — do NOT wait on the session-store walk (can be tens
        // of seconds on a large ~/.pi/agent/sessions tree and freezes main IPC).
        useAppStore.getState().setCurrentView('home')
      } else {
        useAppStore.getState().setCurrentView('chat')
      }

      // The status bar is on screen before any agent starts, and the engine is
      // only carried on status payloads. Ask once at boot, or the bar reads
      // "Pi stopped" for a user whose configured engine is OMP. Only the
      // engine is adopted: the status itself is owned by the lifecycle
      // actions, which may already be starting a session by now.
      void window.piDesktop.pi.getStatus()
        .then((status) => {
          if (status.engine) useAppStore.setState({ piEngine: status.engine })
        })
        .catch(() => undefined)

      // Background: session list, tags, notes, models, updates.
      void refreshSessionList()
      void useAppStore.getState().refreshWorkflowRuns()
      void useAppStore.getState().loadTags()
      void useAppStore.getState().loadArchivedSessions()
      void useAppStore.getState().loadNotes()
      await useAppStore.getState().loadCustomModels()
      if (!hasConfiguredChatModel(useAppStore.getState().customModels)) {
        useAppStore.getState().setCurrentView('model-setup')
      }
      void useAppStore.getState().checkForUpdates()
      const hasWorkspace = useAppStore.getState().activeWorkspace != null
        || useAppStore.getState().workspaces.length > 0

      if (hasWorkspace) {
        void startPi().then(() => refreshSessionStats()).catch(() => undefined)
      }
      void window.piDesktop.workspace.getActivity()
        .then((activity) => useAppStore.getState().handleWorkspaceActivity(activity))
        .catch(() => undefined)
    }

    initialize()
  }, [startPi, loadSettings, loadWorkspaces, refreshSessionStats, refreshSessionList])

  // A release published while the app stays open would otherwise go unnoticed:
  // the startup check above runs once and a running app gives the user no
  // reason to restart. Re-check on a timer so the banner can appear on its own.
  //
  // Kept in its own effect rather than folded into the one-shot init above,
  // because that one returns early on every later run (the `initialized` ref)
  // and would therefore never re-register a timer. The kernel half of a check is
  // cached in main for two hours and the periodic check stands down entirely for
  // two hours after GitHub rate-limits the exit IP, so half-hourly ticks cost
  // well under the 60 anonymous requests/hour that exit has to share.
  // checkForUpdates is signature-aware, so this cannot re-open a banner the user
  // already dismissed for the same offer.
  useEffect(() => {
    const timer = setInterval(() => {
      void useAppStore.getState().checkForUpdates({ automatic: true })
    }, UPDATE_RECHECK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])
}

/**
 * Global shortcut (Ctrl+Shift+P) that toggles the quick note picker, letting
 * the user insert a saved prompt from anywhere in the app. (Ctrl+Shift+N is
 * reserved for the New Workspace menu accelerator.)
 */
export function useNotePickerShortcut(): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault()
        const { notePickerOpen, setNotePickerOpen } = useAppStore.getState()
        setNotePickerOpen(!notePickerOpen)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
