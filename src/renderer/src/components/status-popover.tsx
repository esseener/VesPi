import { useEffect, useRef, useState } from 'react'
import { Activity } from 'lucide-react'
import { useAppStore } from '../store'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'

type TerminalState = Awaited<ReturnType<Window['piDesktop']['terminal']['state']>>

/** This status belongs to the visible OMP TUI, not the historical RPC client. */
export function StatusPopover(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<TerminalState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const terminalStatus = useAppStore(s => s.terminalStatus)
  const language = useAppStore(s => s.settingsDraft.language ?? s.settings?.language ?? DEFAULT_LANGUAGE)
  useEffect(() => {
    if (!open) return
    let disposed = false
    const refresh = async (): Promise<void> => {
      try {
        const next = await window.piDesktop.terminal.state()
        if (!disposed) { setState(next); setError(null) }
      } catch (err) { if (!disposed) setError(String(err)) }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 1500)
    const outside = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const escape = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      disposed = true
      clearInterval(timer)
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  const rows = state ? [
    [t(language, 'status'), state.running ? state.busy ? (language === 'zh' ? '执行中' : 'Working') : t(language, 'statusReady') : t(language, 'statusStopped')],
    ['PID', state.pid?.toString() ?? '—'],
    [t(language, 'model'), state.model ?? '—'],
    [language === 'zh' ? '思考等级' : 'Thinking', state.thinkingLevel ?? '—'],
    [language === 'zh' ? '工作目录' : 'Working directory', state.cwd],
    [language === 'zh' ? '当前会话' : 'Current session', state.sessionPath ?? '—'],
  ] : []
  return <div ref={ref} className="relative">
    <button title={t(language, 'systemStatus')} onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-surface-hover">
      <span className={`h-2 w-2 rounded-full ${terminalStatus === 'running' ? 'bg-success' : terminalStatus === 'error' ? 'bg-error' : 'bg-muted'}`} />
      <Activity size={12} className="text-muted" />
    </button>
    {open && <div style={{ background: 'var(--color-surface)' }} className="absolute top-full left-0 mt-1 w-80 max-w-[calc(100vw-2rem)] surface-floating shadow-2xl overflow-hidden z-50">
      <div className="px-4 py-3 border-b border-border text-sm font-medium text-primary">OMP · {t(language, 'systemStatus')}</div>
      <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
        {error && <p className="text-xs text-error break-words">{error}</p>}
        {rows.map(([label, value]) => <div key={label} className="text-xs"><div className="text-muted mb-1">{label}</div><div className="text-primary break-all select-text">{value}</div></div>)}
      </div>
    </div>}
  </div>
}
