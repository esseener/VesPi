import { useState } from 'react'
import { Globe, ExternalLink } from 'lucide-react'
import { useAppStore } from '../store'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'

const Webview = 'webview' as unknown as React.FC<
  React.HTMLAttributes<HTMLElement> & { src: string; partition?: string }
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

export function BrowserPanel(): React.JSX.Element {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const insertPrompt = useAppStore((state) => state.insertPrompt)
  const [draft, setDraft] = useState('')
  const [url, setUrl] = useState<string | null>(null)

  const open = (): void => {
    const next = normalizeUrl(draft)
    if (next) setUrl(next)
  }

  const askModel = (): void => {
    const next = normalizeUrl(draft)
    if (!next) return
    insertPrompt(`用 browser 工具打开并查看：${next}`, true)
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
        <Webview src={url} partition="vespi-browser" className="min-h-0 flex-1" />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs text-dim">
          {t(language, 'browserPanelHint')}
        </div>
      )}
    </div>
  )
}
