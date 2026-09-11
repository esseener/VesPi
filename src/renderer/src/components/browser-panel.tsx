import { useEffect, useRef, useState } from 'react'
import { Globe, ExternalLink, Loader2, RefreshCw, AlertTriangle } from 'lucide-react'
import { useAppStore } from '../store'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import { VESPI_BROWSER_PARTITION } from '../../../shared/vespi'

// `<webview>` (enabled via webviewTag) isn't a typed JSX intrinsic; cast the tag
// to a component so TS accepts the props we use. The guest runs out-of-process
// under VESPI_BROWSER_PARTITION — sandboxed, isolated and preload-free, and the
// only guest the main process lets off the local disk (see will-attach-webview
// in main/index.ts).
const Webview = 'webview' as unknown as React.FC<
  React.HTMLAttributes<HTMLElement> & {
    src: string
    partition?: string
    ref?: React.Ref<HTMLElement>
  }
>

function normalizeUrl(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'failed'; detail: string }

export function BrowserPanel(): React.JSX.Element {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const insertPrompt = useAppStore((state) => state.insertPrompt)
  const [draft, setDraft] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  // Bumped by retry/re-open so the <webview> remounts and re-attaches listeners.
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<LoadState>({ kind: 'idle' })
  const webviewRef = useRef<HTMLElement | null>(null)

  // The guest reports load progress only through DOM events, so the panel can
  // never render a silent blank page: a failure surfaces its reason and a
  // retry, and a slow page shows a spinner instead of looking broken.
  useEffect(() => {
    const el = webviewRef.current
    if (!el || !url) return
    const started = (): void => setLoad({ kind: 'loading' })
    const stopped = (): void =>
      setLoad((prev) => (prev.kind === 'failed' ? prev : { kind: 'ready' }))
    const failed = (event: Event): void => {
      const info = event as unknown as { errorCode?: number; errorDescription?: string }
      // -3 is ERR_ABORTED: an ordinary stop or redirect, not a real failure.
      if (info.errorCode === -3) return
      setLoad({
        kind: 'failed',
        detail: `${info.errorDescription ?? 'unknown error'} (${info.errorCode ?? '?'})`,
      })
    }
    el.addEventListener('did-start-loading', started)
    el.addEventListener('did-stop-loading', stopped)
    el.addEventListener('did-fail-load', failed)
    return () => {
      el.removeEventListener('did-start-loading', started)
      el.removeEventListener('did-stop-loading', stopped)
      el.removeEventListener('did-fail-load', failed)
    }
  }, [url, attempt])

  const open = (): void => {
    const next = normalizeUrl(draft)
    if (!next) return
    if (next === url) setAttempt((n) => n + 1)
    else setUrl(next)
    setLoad({ kind: 'loading' })
  }

  const reload = (): void => {
    setLoad({ kind: 'loading' })
    setAttempt((n) => n + 1)
  }

  const askModel = (): void => {
    const next = normalizeUrl(draft)
    if (!next) return
    insertPrompt(t(language, 'browserPanelAskModelPrompt', { url: next }), true)
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Globe size={13} className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-primary">{t(language, 'browserPanelTitle')}</div>
          <div className="truncate text-[10px] text-faint">{t(language, 'browserPanelHint')}</div>
        </div>
      </div>
      <form
        className="flex items-center gap-1.5 border-b border-border px-2 py-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          open()
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t(language, 'browserPanelPlaceholder')}
          className="min-w-0 flex-1 rounded-md border border-border bg-app px-2 py-1 text-xs text-primary outline-none placeholder:text-faint focus:border-focus"
        />
        <button
          type="submit"
          className="rounded-md border border-border px-2 py-1 text-[11px] text-secondary hover:border-border-strong hover:text-primary"
        >
          {t(language, 'browserPanelOpen')}
        </button>
        <button
          type="button"
          onClick={askModel}
          className="rounded-md border border-border px-2 py-1 text-[11px] text-secondary hover:border-border-strong hover:text-primary"
          title={t(language, 'browserPanelAskModel')}
        >
          <ExternalLink size={12} />
        </button>
      </form>
      {url ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {load.kind === 'loading' && (
            <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-1.5 border-b border-border bg-surface/95 py-1 text-[11px] text-muted">
              <Loader2 size={11} className="animate-spin" />
              {t(language, 'browserPanelLoading')}
            </div>
          )}
          {load.kind === 'failed' && (
            <div className="flex items-start gap-2 border-b border-border bg-error-bg/30 px-3 py-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-error" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-primary">{t(language, 'browserPanelFailed')}</div>
                <div className="mt-0.5 break-words text-[11px] text-muted">{load.detail}</div>
              </div>
              <button
                type="button"
                onClick={reload}
                className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-secondary hover:border-border-strong hover:text-primary"
              >
                <RefreshCw size={11} />
                {t(language, 'browserPanelReload')}
              </button>
            </div>
          )}
          <Webview
            key={attempt}
            ref={webviewRef}
            src={url}
            partition={VESPI_BROWSER_PARTITION}
            className="min-h-0 flex-1"
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs text-dim">
          {t(language, 'browserPanelHint')}
        </div>
      )}
    </div>
  )
}
