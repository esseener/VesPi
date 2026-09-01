import { useEffect, useState } from 'react'
import { Cpu, RefreshCw } from 'lucide-react'
import { useAppStore } from '../store'
import { firstConfiguredChatModel, type ModelsConfig } from '../../../shared/models-config'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import vespiCenterLogo from '../assets/vespi-center-logo.png'

const API_OPTIONS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
] as const

export function ModelSetupScreen(): React.JSX.Element {
  const language = useAppStore((s) => s.settingsDraft.language ?? s.settings?.language ?? DEFAULT_LANGUAGE)
  const customModels = useAppStore((s) => s.customModels)
  const loadCustomModels = useAppStore((s) => s.loadCustomModels)
  const saveCustomModels = useAppStore((s) => s.saveCustomModels)
  const setCurrentView = useAppStore((s) => s.setCurrentView)
  const configured = firstConfiguredChatModel(customModels)

  const [provider, setProvider] = useState('openai')
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [api, setApi] = useState<string>(API_OPTIONS[0])
  const [apiKey, setApiKey] = useState('')
  const [modelId, setModelId] = useState('')
  const [busy, setBusy] = useState(false)
  const [probing, setProbing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    void loadCustomModels()
  }, [loadCustomModels])

  useEffect(() => {
    if (!configured) return
    setProvider(configured.provider)
    setBaseUrl(configured.baseUrl)
    setModelId(configured.modelId)
  }, [configured])

  const probe = async (): Promise<void> => {
    if (!baseUrl.trim() || !apiKey.trim()) {
      setError(t(language, 'modelSetupNeedUrlAndKey'))
      return
    }
    setProbing(true)
    setError(null)
    setHint(null)
    try {
      const result = await window.piDesktop.models.probe({
        baseUrl: baseUrl.trim(),
        api,
        apiKey: apiKey.trim(),
      })
      if (!result.ok) {
        setError(t(language, 'probeFailed', { error: result.error }))
        return
      }
      if (!modelId.trim() && result.models[0]?.id) setModelId(result.models[0].id)
      setHint(t(language, 'fetchedModels', { count: String(result.models.length) }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setProbing(false)
    }
  }

  const save = async (): Promise<void> => {
    const name = provider.trim()
    const url = baseUrl.trim()
    const key = apiKey.trim()
    const id = modelId.trim()
    if (!name || !url || !key || !id) {
      setError(t(language, 'modelSetupNeedAll'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const config: ModelsConfig = {
        providers: {
          [name]: {
            baseUrl: url,
            api,
            apiKey: key,
            models: [{ id }],
          },
        },
      }
      const result = await saveCustomModels(config)
      if (!result.ok) {
        setError((result.errors ?? [t(language, 'saveFailed')]).join('\n'))
        return
      }
      const updated = await window.piDesktop.settings.save({
        defaultProvider: name,
        defaultModel: id,
      })
      useAppStore.setState({ settings: updated })
      setCurrentView('home')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-xl flex-col justify-center px-8 py-12">
        <img src={vespiCenterLogo} alt={t(language, 'appName')} draggable={false} className="mx-auto h-20 w-auto max-w-[22rem]" />
        <div className="mt-6 flex items-center justify-center gap-2 text-sm font-medium text-primary">
          <Cpu size={16} />
          {t(language, 'modelSetupTitle')}
        </div>
        <p className="mt-2 text-center text-sm text-dim">{t(language, 'modelSetupSubtitle')}</p>
        <p className="mt-1 text-center text-xs text-faint">{t(language, 'modelSetupNoBundledKey')}</p>

        <div className="mt-8 space-y-3 rounded-lg border border-border bg-surface/40 p-4">
          <label className="block text-xs text-dim">
            {t(language, 'providerKeyPlaceholder')}
            <input
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              className="mt-1 w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-sm text-primary"
            />
          </label>
          <label className="block text-xs text-dim">
            {t(language, 'providerBaseUrl')}
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              className="mt-1 w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-sm text-primary"
            />
          </label>
          <label className="block text-xs text-dim">
            {t(language, 'modelApi')}
            <select
              value={api}
              onChange={(event) => setApi(event.target.value)}
              className="mt-1 w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-sm text-primary"
            >
              {API_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-dim">
            {t(language, 'providerApiKey')}
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className="mt-1 w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-sm text-primary"
            />
          </label>
          <label className="block text-xs text-dim">
            {t(language, 'modelIdPlaceholder')}
            <input
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              className="mt-1 w-full rounded border border-border-strong bg-surface px-2 py-1.5 text-sm text-primary"
            />
          </label>
          {error ? <div className="text-xs text-error">{error}</div> : null}
          {hint ? <div className="text-xs text-success">{hint}</div> : null}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void probe()}
              disabled={probing || busy}
              className="flex items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-xs text-secondary hover:bg-surface-hover disabled:opacity-50"
            >
              <RefreshCw size={12} className={probing ? 'animate-spin' : undefined} />
              {probing ? t(language, 'testingProvider') : t(language, 'testFetchModels')}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="rounded-md border border-border-strong bg-transparent px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent-fg hover:text-primary disabled:opacity-50"
            >
              {t(language, 'modelSetupSave')}
            </button>
            {configured ? (
              <button
                type="button"
                onClick={() => setCurrentView('home')}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-secondary hover:bg-surface-hover"
              >
                {t(language, 'modelSetupLater')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
