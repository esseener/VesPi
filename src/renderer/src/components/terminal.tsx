import { useEffect, useRef, useState } from 'react'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '../store'
import { DEFAULT_SETTINGS } from '../../../shared/default-settings'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import { createTerminalTranslator, squareBoxCorners } from '../../../shared/omp-labels'
import { clsx } from 'clsx'
import { Copy, ClipboardPaste, TextSelect, Search, ArrowUp, ArrowDown, X } from 'lucide-react'
import { useContextMenu } from './context-menu'
import { playCompletionChime } from '../completion-chime'

// Build the xterm color theme from the active app theme's CSS variables so the
// terminal matches whichever theme (dark/light/nord/gruvbox/breeze) is applied.
// Falls back to the dark palette if a variable is missing.
// Gray/dim ramps are pushed up so small chrome text stays readable (WCAG-ish 4.5:1).
function buildTerminalTheme(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string): string => {
    const value = css.getPropertyValue(name).trim()
    return value || fallback
  }

  const bg = v('--color-app', '#070809')
  const fg = v('--color-primary', '#d4d8e4')

  return {
    background: 'rgba(0,0,0,0)',
    foreground: fg,
    cursor: v('--color-accent-fg', '#f08a62'),
    cursorAccent: bg,
    selectionBackground: 'rgba(232, 115, 74, 0.35)',
    black: '#1a1e26',
    red: v('--color-error', '#e06b66'),
    green: v('--color-success', '#8fbf7a'),
    yellow: v('--color-warning', '#e8a85c'),
    blue: v('--color-accent', '#e8734a'),
    magenta: '#c46a4a',
    cyan: '#8ab0c4',
    white: fg,
    // ANSI 8 — OMP uses this for secondary/tip text. Must stay readable.
    brightBlack: '#a8aebc',
    brightRed: '#ef807a',
    brightGreen: '#a4d48c',
    brightYellow: '#f0bc72',
    brightBlue: '#f08a62',
    brightMagenta: '#d48868',
    brightCyan: '#a8ccd8',
    brightWhite: '#eef1f7',
  }
}

/** Paste OS clipboard into the TUI: images as a file path, text as bracketed paste. */
async function pasteClipboardToTerminal(terminal: XTerm): Promise<void> {
  try {
    const clip = await window.piDesktop.system.paste()
    if (clip.kind === 'image') {
      // OMP/agents read the PNG by path (same as a screenshot attachment).
      terminal.paste(clip.path)
    } else if (clip.text) {
      terminal.paste(clip.text)
    }
  } catch {
    /* clipboard unavailable */
  }
}

export function TerminalPanel({ className, searchOpen = false, searchNonce = 0, onCloseSearch }: { className?: string; searchOpen?: boolean; searchNonce?: number; onCloseSearch?: () => void } = {}): React.JSX.Element | null {
  const terminalOpen = useAppStore((state) => state.terminalOpen)
  const activeWorkspace = useAppStore((state) => state.activeWorkspace)
  const pendingInsert = useAppStore((state) => state.pendingInsert)
  const currentView = useAppStore((state) => state.currentView)
  const terminalStatus = useAppStore((state) => state.terminalStatus)
  const theme = useAppStore((state) => state.settings?.theme)
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const { show: showMenu, ContextMenuComponent } = useContextMenu()

  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const translatorRef = useRef(createTerminalTranslator())
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [noMatch, setNoMatch] = useState(false)
  const find = (backwards = false): void => {
    if (!query || !searchRef.current) { setNoMatch(false); return }
    setNoMatch(!(backwards ? searchRef.current.findPrevious(query) : searchRef.current.findNext(query)))
  }
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen, searchNonce])

  // Kernel swap: restart the local TUI onto the new omp.exe. Stay on chat —
  // do not bounce to Home; resume keeps the conversation if any.
  useEffect(() => {
    const off = window.piDesktop.updates.onKernelProgress((p) => {
      if (p.phase === 'done') {
        if (!useAppStore.getState().terminalOpen) return
        useAppStore.setState({ terminalStatus: 'starting' })
        void window.piDesktop.terminal.restart().then((result) => {
          if (!result.ok) throw new Error('Terminal restart failed')
          useAppStore.setState({ terminalStatus: 'running', terminalError: null })
          void useAppStore.getState().refreshSessionList()
          void useAppStore.getState().checkForUpdates({ automatic: false })
        }).catch((error: unknown) => useAppStore.setState({ terminalStatus: 'error', terminalError: String(error) }))
      }
    })
    return off
  }, [])

  // OMP TUI 自己写会话文件，rpc-ui 无事件 → 轮询刷新侧栏会话
  useEffect(() => {
    if (!terminalOpen) return
    let previous: { pid: number | null; completed: number } | null = null
    let disposed = false
    const refresh = async (): Promise<void> => {
      try {
        const state = await window.piDesktop.terminal.state()
        if (disposed) return
        const settings = useAppStore.getState().settings
        if (previous?.pid === state.pid && state.completed > previous.completed && settings?.completionChime) playCompletionChime(settings.completionChimeVolume)
        previous = state
      } catch { /* A stopped or restarting terminal has no state yet. */ }
    }
    const id = setInterval(() => {
      void useAppStore.getState().refreshSessionList()
    }, 6_000)
    const stateTimer = setInterval(() => void refresh(), 1500)
    void refresh()
    return () => { disposed = true; clearInterval(id); clearInterval(stateTimer) }
  }, [terminalOpen])

  useEffect(() => {
    if (!terminalOpen || !containerRef.current) return
    let disposed = false
    translatorRef.current.reset()
    useAppStore.setState({ terminalStatus: 'starting', terminalError: null })

    const terminal = new XTerm({
      allowProposedApi: true,
      cursorBlink: true,
      convertEol: true,
      // Box-drawing (│ ─) first: Cascadia/Consolas draw full-height glyphs.
      // JetBrains Mono stays for ligatures; CJK fonts fill wide chars.
      fontFamily: "'Cascadia Mono', 'Consolas', 'JetBrains Mono Variable', 'JetBrains Mono', 'Cascadia Code', 'Microsoft YaHei UI', 'Microsoft YaHei', 'PingFang SC', 'Noto Sans Mono CJK SC', monospace",
      letterSpacing: 0,
      // Must be 1.0 so box-drawing glyphs (│ ─) touch across rows.
      lineHeight: 1,
      // Helps box-drawing glyphs meet at cell edges.
      rescaleOverlappingGlyphs: true,
      // Force readable contrast for dim/gray TUI chrome (tips, recap, meta).
      minimumContrastRatio: 5,
      // Use the Terminal Font Size setting (or the unsaved settings draft),
      // read once at creation. Applied on the next mount — i.e. when the user
      // returns to chat — rather than live, to avoid resizing a hidden pty.
      // Falls back to the default.
      fontSize:
        useAppStore.getState().settingsDraft.terminalFontSize ??
        useAppStore.getState().settings?.terminalFontSize ??
        DEFAULT_SETTINGS.terminalFontSize,
      theme: buildTerminalTheme(),
    })
    // Ctrl+V / Ctrl+Shift+V paste into the PTY (right-click menu does the same).
    // Screenshots go out as a file path the agent can read; text is bracketed paste.
    terminal.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true
      const key = ev.key.toLowerCase()
      if ((ev.ctrlKey || ev.metaKey) && key === 'v') {
        void pasteClipboardToTerminal(terminal)
        return false
      }
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && key === 'c' && terminal.hasSelection()) {
        void navigator.clipboard.writeText(terminal.getSelection())
        return false
      }
      return true
    })
    const fit = new FitAddon()
    terminal.loadAddon(new Unicode11Addon())
    terminal.unicode.activeVersion = '11'
    terminal.loadAddon(fit)
    terminal.loadAddon(new WebLinksAddon())
    const search = new SearchAddon()
    terminal.loadAddon(search)
    searchRef.current = search
    terminal.open(containerRef.current)

    terminalRef.current = terminal
    fitRef.current = fit

    const fitAndResize = () => {
      if (disposed || !containerRef.current?.clientWidth || !containerRef.current.clientHeight) return
      fit.fit()
      window.piDesktop.terminal.resize(terminal.cols, terminal.rows)
    }

    const dataDisposable = terminal.onData((data) => {
      window.piDesktop.terminal.input(data)
    })
    const outputCleanup = window.piDesktop.terminal.onData((data) => {
      if (useAppStore.getState().terminalStatus !== 'running') useAppStore.setState({ terminalStatus: 'running' })
      const state = useAppStore.getState()
      const lang = state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE
      const viewport = terminal.buffer.active.viewportY
      const follow = state.settingsDraft.autoScroll ?? state.settings?.autoScroll ?? true
      terminal.write(lang === 'en' ? squareBoxCorners(data) : translatorRef.current.write(data), () => {
        if (!follow) terminal.scrollToLine(viewport)
      })
    })
    const exitCleanup = window.piDesktop.terminal.onExit((event) => {
      useAppStore.setState({ terminalStatus: event.exitCode === 0 ? 'stopped' : 'error' })
      terminal.writeln('')
      const lang = useAppStore.getState().settingsDraft.language
        ?? useAppStore.getState().settings?.language
        ?? DEFAULT_LANGUAGE
      terminal.writeln(t(lang, 'terminalProcessExited', { code: String(event.exitCode) }))
    })

    const startTimer = window.setTimeout(async () => {
      fitAndResize()
      try {
        await window.piDesktop.terminal.start({
          cwd: activeWorkspace?.path,
          cols: terminal.cols,
          rows: terminal.rows,
        })
        if (!disposed) useAppStore.setState({ terminalStatus: 'running' })
      } catch (err) {
        if (disposed) return
        useAppStore.setState({ terminalStatus: 'error', terminalError: err instanceof Error ? err.message : String(err) })
        const lang = useAppStore.getState().settingsDraft.language
          ?? useAppStore.getState().settings?.language
          ?? DEFAULT_LANGUAGE
        terminal.writeln(t(lang, 'terminalFailedStart', {
          error: err instanceof Error ? err.message : String(err),
        }))
      }
      if (!disposed) terminal.focus()
    }, 0)

    window.addEventListener('resize', fitAndResize)
    const ro = new ResizeObserver(() => fitAndResize())
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      disposed = true
      window.clearTimeout(startTimer)
      window.removeEventListener('resize', fitAndResize)
      ro.disconnect()
      dataDisposable.dispose()
      outputCleanup()
      exitCleanup()
      window.piDesktop.terminal.stop()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
      searchRef.current = null
      useAppStore.setState({ terminalStatus: 'stopped' })
    }
  }, [terminalOpen, activeWorkspace?.path])

  // Notes, browser actions and palette entries fill the live TUI draft. They
  // never submit it: the user still reviews the text and presses Enter.
  useEffect(() => {
    const terminal = terminalRef.current
    if (!pendingInsert || !terminal || !terminalOpen || terminalStatus !== 'running' || currentView !== 'chat') return
    if (pendingInsert.replace) window.piDesktop.terminal.input('\x01\x0b')
    terminal.paste(pendingInsert.text)
    terminal.focus()
    useAppStore.getState().clearPendingInsert()
  }, [pendingInsert, currentView, terminalOpen, terminalStatus])

  useEffect(() => {
    if (!terminalOpen) return
    const timer = window.setTimeout(() => {
      fitRef.current?.fit()
      const terminal = terminalRef.current
      if (terminal) {
        window.piDesktop.terminal.resize(terminal.cols, terminal.rows)
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [terminalOpen])

  // Recolor the live terminal when the app theme changes, without recreating it.
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = buildTerminalTheme()
    }
  }, [theme])

  // After a local PTY restart (model/theme/kernel), keep the shell on chat:
  // wipe the stale buffer, restore font metrics, put the caret in the TUI.
  useEffect(() => {
    let timer: number | undefined
    const off = window.piDesktop.terminal.onRestarted(() => {
      useAppStore.setState({ terminalStatus: 'running', terminalError: null })
      const term = terminalRef.current
      if (!term) return
      term.clear()
      translatorRef.current.reset()
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (terminalRef.current !== term) return
        fitRef.current?.fit()
        term.focus()
        const cols = term.cols
        const rows = term.rows
        window.piDesktop.terminal.resize(cols, rows)
      }, 50)
    })
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [terminalOpen])

  // Clear is triggered from the toolbar (icon button beside the side-panel toggle).
  useEffect(() => {
    const onClear = (): void => {
      terminalRef.current?.clear()
    }
    window.addEventListener('vespi:terminal-clear', onClear)
    return () => window.removeEventListener('vespi:terminal-clear', onClear)
  }, [terminalOpen])

  if (!terminalOpen) return null

  const onContextMenu = (e: React.MouseEvent): void => {
    const term = terminalRef.current
    if (!term) return
    const selection = term.getSelection()
    const lang =
      useAppStore.getState().settingsDraft.language ??
      useAppStore.getState().settings?.language ??
      DEFAULT_LANGUAGE
    showMenu(e, [
      {
        id: 'copy',
        label: t(lang, selection ? 'copySelection' : 'copy'),
        icon: <Copy size={14} />,
        shortcut: 'Ctrl+Shift+C',
        disabled: !selection,
        action: () => {
          if (selection) void navigator.clipboard.writeText(selection).catch(() => undefined)
        },
      },
      {
        id: 'paste',
        label: t(lang, 'paste'),
        icon: <ClipboardPaste size={14} />,
        shortcut: 'Ctrl+V',
        action: () => {
          const term = terminalRef.current
          if (term) void pasteClipboardToTerminal(term)
        },
      },
      {
        id: 'select-all',
        label: t(lang, 'selectAll'),
        icon: <TextSelect size={14} />,
        shortcut: 'Ctrl+A',
        action: () => terminalRef.current?.selectAll(),
      },
    ])
  }

  return (
    <div
      data-main-terminal
      className={clsx('flex min-h-0 flex-1 flex-col bg-transparent', className)}
      onContextMenu={onContextMenu}
    >
      {searchOpen && <div role="search" className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <Search size={14} className="text-muted" />
        <input ref={searchInputRef} value={query} aria-label={t(language, 'terminalSearch')} placeholder={t(language, 'terminalSearchPlaceholder')} onChange={(event) => { const value = event.target.value; setQuery(value); setNoMatch(Boolean(value) && !(searchRef.current?.findNext(value, { incremental: true }) ?? false)) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); find(event.shiftKey) } if (event.key === 'Escape') { onCloseSearch?.(); terminalRef.current?.focus() } }} className="min-w-0 flex-1 rounded border border-border-strong bg-app px-2 py-1 text-sm text-primary outline-none focus:border-accent-fg" />
        {noMatch && <span role="status" className="text-xs text-warning">{t(language, 'terminalNoMatch')}</span>}
        <button type="button" title={t(language, 'terminalPrevious')} aria-label={t(language, 'terminalPrevious')} onClick={() => find(true)} className="rounded p-2 text-muted hover:bg-surface-hover"><ArrowUp size={14} /></button>
        <button type="button" title={t(language, 'terminalNext')} aria-label={t(language, 'terminalNext')} onClick={() => find()} className="rounded p-2 text-muted hover:bg-surface-hover"><ArrowDown size={14} /></button>
        <button type="button" aria-label={t(language, 'close')} onClick={() => { onCloseSearch?.(); terminalRef.current?.focus() }} className="rounded p-2 text-muted hover:bg-surface-hover"><X size={14} /></button>
      </div>}
      <div className="flex min-h-0 flex-1 overflow-hidden p-3">
        <div ref={containerRef} className="min-h-0 min-w-0 flex-1 overflow-hidden" />
      </div>
      {ContextMenuComponent}
    </div>
  )
}
