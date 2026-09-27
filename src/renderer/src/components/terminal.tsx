import { useEffect, useRef } from 'react'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '../store'
import { DEFAULT_SETTINGS } from '../../../shared/default-settings'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import { translateTerminalChunk } from '../../../shared/omp-labels'
import { clsx } from 'clsx'
import { Copy, ClipboardPaste, TextSelect } from 'lucide-react'
import { useContextMenu } from './context-menu'

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

  const bg = v('--color-app', '#121419')
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

export function TerminalPanel({ className }: { className?: string } = {}): React.JSX.Element | null {
  const terminalOpen = useAppStore((state) => state.terminalOpen)
  const activeWorkspace = useAppStore((state) => state.activeWorkspace)
  const theme = useAppStore((state) => state.settings?.theme)
  const language = useAppStore(
    (state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE,
  )
  const { show: showMenu, ContextMenuComponent } = useContextMenu()

  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  // Kernel swap: restart the local TUI onto the new omp.exe. Stay on chat —
  // do not bounce to Home; resume keeps the conversation if any.
  useEffect(() => {
    const off = window.piDesktop.updates.onKernelProgress((p) => {
      if (p.phase === 'done') {
        const path = useAppStore.getState().sessionState?.sessionFile ?? undefined
        void window.piDesktop.terminal.restart(path).then(() => {
          void useAppStore.getState().refreshSessionList()
          void useAppStore.getState().checkForUpdates({ automatic: false })
        })
      }
    })
    return off
  }, [])

  // OMP TUI 自己写会话文件，rpc-ui 无事件 → 轮询刷新侧栏会话
  useEffect(() => {
    if (!terminalOpen) return
    const id = setInterval(() => {
      void useAppStore.getState().refreshSessionList()
    }, 6_000)
    return () => clearInterval(id)
  }, [terminalOpen])

  useEffect(() => {
    if (!terminalOpen || !containerRef.current) return

    const terminal = new XTerm({
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
      if ((ev.ctrlKey || ev.metaKey) && key === 'v' && !ev.shiftKey) {
        void pasteClipboardToTerminal(terminal)
        return false
      }
      return true
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(containerRef.current)

    terminalRef.current = terminal
    fitRef.current = fit

    const fitAndResize = () => {
      fit.fit()
      window.piDesktop.terminal.resize(terminal.cols, terminal.rows)
    }

    const dataDisposable = terminal.onData((data) => {
      window.piDesktop.terminal.input(data)
    })
    const outputCleanup = window.piDesktop.terminal.onData((data) => {
      terminal.write(translateTerminalChunk(data))
    })
    const exitCleanup = window.piDesktop.terminal.onExit((event) => {
      terminal.writeln('')
      const lang = useAppStore.getState().settingsDraft.language
        ?? useAppStore.getState().settings?.language
        ?? DEFAULT_LANGUAGE
      terminal.writeln(t(lang, 'terminalProcessExited', { code: String(event.exitCode) }))
    })

    window.setTimeout(async () => {
      fitAndResize()
      try {
        const result = await window.piDesktop.terminal.start({
          cwd: activeWorkspace?.path,
          cols: terminal.cols,
          rows: terminal.rows,
        })
      } catch (err) {
        const lang = useAppStore.getState().settingsDraft.language
          ?? useAppStore.getState().settings?.language
          ?? DEFAULT_LANGUAGE
        terminal.writeln(t(lang, 'terminalFailedStart', {
          error: err instanceof Error ? err.message : String(err),
        }))
      }
      terminal.focus()
    }, 0)

    window.addEventListener('resize', fitAndResize)
    const ro = new ResizeObserver(() => fitAndResize())
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      window.removeEventListener('resize', fitAndResize)
      ro.disconnect()
      dataDisposable.dispose()
      outputCleanup()
      exitCleanup()
      window.piDesktop.terminal.stop()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [terminalOpen, activeWorkspace?.path])

  useEffect(() => {
    if (!terminalOpen) return
    window.setTimeout(() => {
      fitRef.current?.fit()
      const terminal = terminalRef.current
      if (terminal) {
        window.piDesktop.terminal.resize(terminal.cols, terminal.rows)
      }
    }, 0)
  }, [terminalOpen])

  // Recolor the live terminal when the app theme changes, without recreating it.
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = buildTerminalTheme()
    }
  }, [theme])

  // After a local PTY restart (model/theme), keep the shell on chat: clear the
  // stale buffer and put the caret back in the TUI input.
  useEffect(() => {
    const off = window.piDesktop.terminal.onRestarted(() => {
      const term = terminalRef.current
      if (!term) return
      term.clear()
      term.focus()
    })
    return off
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
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden px-2 pt-2 pb-12" />
      {ContextMenuComponent}
    </div>
  )
}
