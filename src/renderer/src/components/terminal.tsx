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

export function TerminalPanel({ className }: { className?: string } = {}): React.JSX.Element | null {
  const terminalOpen = useAppStore((state) => state.terminalOpen)
  const activeWorkspace = useAppStore((state) => state.activeWorkspace)
  const theme = useAppStore((state) => state.settings?.theme)

  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  // 内核更新完成后重启终端，换用新 omp.exe / 新译包
  useEffect(() => {
    const off = window.piDesktop.updates.onKernelProgress((p) => {
      if (p.phase === 'done') {
        window.piDesktop.terminal.stop()
        // 重新 start 会由 terminalOpen 的 effect 完成；这里只停掉旧 PTY
        setTimeout(() => {
          window.location.reload()
        }, 400)
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

  if (!terminalOpen) return null

  // Main-column terminal: fills the chat center. No title bar — the top
  // workspace tabs already name the context; clear/close live in the status bar.
  return (
    <div
      data-main-terminal
      className={clsx('flex min-h-0 flex-1 flex-col bg-transparent', className)}
    >
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden px-2 pt-2 pb-12" />
    </div>
  )
}
