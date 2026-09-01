import { useEffect, useState } from 'react'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import { useAppStore } from '../store'

export function WindowControls({ overlay = false }: { overlay?: boolean }): React.JSX.Element | null {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.piDesktop.system.isWindowMaximized().then((value) => {
      if (!cancelled) setMaximized(value)
    })
    const unsubscribe = window.piDesktop.system.onWindowMaximized((value) => {
      setMaximized(value)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  if (window.piDesktop.system.platform !== 'win32') return null

  return (
    <div className={overlay ? 'window-controls-overlay flex h-10' : 'titlebar-no-drag flex h-10 shrink-0'}>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void window.piDesktop.system.minimizeWindow()
        }}
        className="titlebar-no-drag flex h-10 w-11 items-center justify-center text-muted transition-colors hover:bg-white/6 hover:text-primary"
        title={t(language, 'windowMinimize')}
        aria-label={t(language, 'windowMinimize')}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="1" y="4.5" width="8" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void window.piDesktop.system.toggleMaximizeWindow()
        }}
        className="titlebar-no-drag flex h-10 w-11 items-center justify-center text-muted transition-colors hover:bg-white/6 hover:text-primary"
        title={maximized ? t(language, 'windowRestore') : t(language, 'windowMaximize')}
        aria-label={maximized ? t(language, 'windowRestore') : t(language, 'windowMaximize')}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M3 2h5v5H7.2V3.8H3V2Zm-1 2h5v5H2V4Z" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void window.piDesktop.system.closeWindow()
        }}
        className="titlebar-no-drag flex h-10 w-11 items-center justify-center text-muted transition-colors hover:bg-[#c42b1c] hover:text-white"
        title={t(language, 'windowClose')}
        aria-label={t(language, 'windowClose')}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 2l6 6M8 2l-6 6" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
