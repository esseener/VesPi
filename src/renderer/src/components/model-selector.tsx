import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react'
import { OverlayPortal } from './overlay-portal'
import { useAppStore } from '../store'
import type { ModelInfo } from '../../../shared/ipc-contracts'
import { filterModels } from '../utils/model-search'
import { clsx } from 'clsx'
import { Cpu, ChevronUp, ChevronDown, Check, Loader2, Search } from 'lucide-react'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import { thinkingSupport } from '../../../shared/thinking-levels'
import { hasConfiguredChatModel } from '../../../shared/models-config'

interface ModelSelectorProps {
  className?: string
  compact?: boolean
  /** true = open upward (status bar); false = open downward (top toolbar). */
  dropUp?: boolean
}

export function ModelSelector({
  className,
  compact = false,
  dropUp = true,
}: ModelSelectorProps): React.JSX.Element {
  const sessionState = useAppStore((state) => state.sessionState)
  const setModel = useAppStore((state) => state.setModel)
  const terminalStatus = useAppStore((state) => state.terminalStatus)
  const settings = useAppStore((state) => state.settings)
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const customModels = useAppStore((state) => state.customModels)
  const setCurrentView = useAppStore((state) => state.setCurrentView)
  const loadCustomModels = useAppStore((state) => state.loadCustomModels)

  const [isOpen, setIsOpen] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pendingModel, setPendingModel] = useState<string | null>(null)
  const [liveModel, setLiveModel] = useState<string | null>(null)
  useEffect(() => {
    let disposed = false
    const refresh = async (): Promise<void> => {
      try {
        const state = await window.piDesktop.terminal.state()
        if (!disposed) setLiveModel(state.model)
      } catch { /* Terminal may be starting. */ }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 2000)
    return () => { disposed = true; clearInterval(timer) }
  }, [])
  const loadGeneration = useRef(0)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const searchRef = useRef<HTMLInputElement>(null)

  const terminalOpen = useAppStore((state) => state.terminalOpen)
  const currentModel = terminalOpen ? undefined : sessionState?.model
  const fallbackLabel =
    (terminalOpen ? liveModel : null) ??
    currentModel?.name ??
    (settings?.defaultModel
      ? settings.defaultProvider
        ? `${settings.defaultProvider}/${settings.defaultModel}`
        : settings.defaultModel
      : t(language, 'selectModel'))


  const close = (): void => {
    setIsOpen(false)
    setQuery('')
    setError(null)
  }

  const loadModels = useCallback(async (): Promise<void> => {
    const generation = ++loadGeneration.current
    setLoading(true)
    setError(null)
    try {
      // Re-read the config alongside the kernel's list. The two must be compared
      // to decide what to offer, and the config is the half that changes when
      // the user edits providers in settings — reading only the kernel's list
      // left this menu describing a config that no longer existed, so a deleted
      // provider kept appearing until the app restarted.
      const [, response] = await Promise.all([
        loadCustomModels(),
        window.piDesktop.model.listAvailable() as Promise<{
          success?: boolean
          data?: { models?: ModelInfo[] }
        } | null>,
      ])
      if (generation !== loadGeneration.current) return
      if (response?.success && response.data?.models) {
        setModels(response.data.models)
      } else {
        throw new Error(t(language, 'modelListFailed'))
      }
    } catch {
      if (generation !== loadGeneration.current) return
      setModels([])
      setError(t(language, 'modelListFailed'))
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }, [language, loadCustomModels])

  const open = async (): Promise<void> => {
    if (isOpen) {
      close()
      return
    }
    setIsOpen(true)
  }

  useEffect(() => {
    if (!isOpen) return
    void loadModels()
    const generation = loadGeneration.current
    return () => { loadGeneration.current = generation + 1 }
  }, [isOpen, loadModels])

  useEffect(() => {
    if (!isOpen) return
    const id = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  useLayoutEffect(() => {
    if (!isOpen) return
    const place = (): void => {
      const trigger = ref.current?.getBoundingClientRect()
      if (!trigger) return
      const width = Math.min(320, window.innerWidth - 16)
      const room = dropUp ? trigger.top - 12 : window.innerHeight - trigger.bottom - 12
      setMenuStyle({
        width,
        left: Math.max(8, Math.min(trigger.right - width, window.innerWidth - width - 8)),
        maxHeight: Math.max(120, room),
        ...(dropUp ? { bottom: window.innerHeight - trigger.top + 4 } : { top: trigger.bottom + 4 }),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [isOpen, dropUp])

  // The fresh native catalog also includes OAuth and YAML-only providers.
  // A legacy JSON mirror must not hide models OMP can actually use.
  const filteredModels = useMemo(() => filterModels(models, query), [models, query])

  const handleSelect = async (model: ModelInfo): Promise<void> => {
    if (pendingModel) return
    setPendingModel(`${model.provider}/${model.id}`)
    setError(null)
    try {
      await setModel(model.provider, model.id)
      close()
    } catch (error) {
      setError(t(language, 'terminalActionFailed', { error: error instanceof Error ? error.message : String(error) }))
    } finally {
      setPendingModel(null)
    }
  }

  return (
    <div ref={ref} className={clsx('relative', className)} onKeyDown={(event) => { if (event.key === 'Escape') { close(); ref.current?.querySelector('button')?.focus(); event.stopPropagation() } }}>
      <button
        type="button"
        onClick={() => void open()}
        disabled={terminalStatus === 'starting' || Boolean(pendingModel)}
        className={clsx(
          'flex h-8 max-w-52 items-center gap-1.5 rounded-md px-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-accent-fg disabled:opacity-50',
          isOpen ? 'bg-surface-hover text-primary' : 'text-dim hover:bg-surface-hover hover:text-secondary',
          compact && 'max-w-36',
        )}
        title={t(language, 'selectModelHint')}
        aria-label={t(language, 'selectModel')}
        aria-expanded={isOpen}
      >
        {pendingModel ? <Loader2 size={14} className="shrink-0 animate-spin" /> : <Cpu size={14} className="shrink-0" />}
        <span className="min-w-0 truncate">{fallbackLabel}</span>
        {dropUp ? (
          <ChevronUp
            size={10}
            className={clsx('shrink-0 transition-transform', isOpen && 'rotate-180')}
          />
        ) : (
          <ChevronDown
            size={10}
            className={clsx('shrink-0 transition-transform', isOpen && 'rotate-180')}
          />
        )}
      </button>

      {isOpen && <OverlayPortal>
        <div
          ref={menuRef}
          role="dialog"
          aria-label={t(language, 'selectModel')}
          style={menuStyle}
          onKeyDown={(event) => { if (event.key === 'Escape') { close(); ref.current?.querySelector('button')?.focus(); event.stopPropagation() } }}
          className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-border-strong bg-surface py-1 shadow-xl shadow-black/40"
        >
          {currentModel && (
            <div className="border-b border-border px-3 py-2">
              <div className="text-xs text-muted">{t(language, 'currentModel')}</div>
              <div className="text-sm font-medium text-primary">{currentModel.name}</div>
              <div className="mt-0.5 text-xs text-dim">
                {currentModel.provider} · {currentModel.id}
              </div>
            </div>
          )}

          <p className="border-b border-border px-3 py-2 text-xs text-muted">{t(language, 'modelPreferenceHint')}</p>
          {!loading && models.length === 0 && !hasConfiguredChatModel(customModels) && (
            <button
              type="button"
              onClick={() => {
                close()
                setCurrentView('model-setup')
              }}
              className="w-full border-b border-border px-3 py-2 text-left text-xs text-accent-fg hover:bg-surface-hover"
            >
              {t(language, 'configureModel')}
            </button>
          )}

          <>
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Search size={12} className="shrink-0 text-dim" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t(language, 'searchModels')}
                  className="min-w-0 flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-faint"
                />
              </div>
              <div className="min-h-0 max-h-56 overflow-y-auto py-1">
                {loading && (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs text-dim">
                    <Loader2 size={12} className="animate-spin" />
                    {t(language, 'loading')}
                  </div>
                )}
                {error && <div role="alert" className="px-3 py-2 text-xs text-error">{error}</div>}
                {!loading && !error && filteredModels.length === 0 && (
                  <div className="px-3 py-2 text-xs text-dim">{t(language, 'noModelsMatch')}</div>
                )}
                {filteredModels.map((model) => {
                  const selected =
                    (currentModel?.id ?? settings?.defaultModel) === model.id && (currentModel?.provider ?? settings?.defaultProvider) === model.provider
                  // The kernel hands back what each model accepts, so the choice
                  // can be an informed one instead of a discovery afterwards.
                   const support = model.reasoning === undefined ? { kind: 'undeclared' as const } : thinkingSupport(model)
                  return (
                    <button
                      key={`${model.provider}/${model.id}`}
                      type="button"
                      onClick={() => void handleSelect(model)}
                      disabled={Boolean(pendingModel) || loading}
                      className={clsx(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover transition-colors disabled:opacity-50',
                        selected && 'bg-card'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-primary">{model.name}</div>
                        <div className="truncate text-xs text-dim">
                          {model.provider} · {model.id}
                        </div>
                        <div className="truncate text-[10px] text-faint">
                          {support.kind === 'levels'
                            ? t(language, 'thinkingSupported', {
                                levels: support.levels
                                  .filter((level) => level !== 'off')
                                  .join(' / '),
                              })
                            : support.kind === 'undeclared'
                              ? t(language, 'thinkingNotDeclared')
                              : t(language, 'thinkingNoSupport')}
                        </div>
                      </div>
                      {pendingModel === `${model.provider}/${model.id}` ? <Loader2 size={14} className="animate-spin" /> : selected && <Check size={12} className="shrink-0 text-success" />}
                    </button>
                  )
                })}
              </div>
            </>
        </div>
      </OverlayPortal>}
    </div>
  )
}
