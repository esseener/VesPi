import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, Plus, Trash2, Save, RefreshCw, AlertTriangle } from 'lucide-react'
import { useAppStore } from '../store'
import { withImageInput } from '../../../shared/models-config'
import type { ModelsConfig, ProviderConfig, CustomModel } from '../../../shared/models-config'
import { BUILTIN_PROVIDERS, isBuiltinProviderKey } from '../../../shared/builtin-providers'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import { ThemedSelect } from './themed-select'

const API_OPTIONS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
]

interface ProviderRow {
  /** Stable identity for the fold state; never derived from editable text. */
  uid: string
  key: string
  baseUrl: string
  api: string
  apiKey: string
  compat: ProviderConfig['compat']
  models: CustomModel[]
}

function emptyRow(partial?: Partial<ProviderRow>): ProviderRow {
  return {
    uid: '',
    key: '',
    baseUrl: '',
    api: API_OPTIONS[0],
    apiKey: '',
    compat: undefined,
    models: [],
    ...partial,
  }
}

function configToRows(config: ModelsConfig | null): ProviderRow[] {
  const saved = Object.entries(config?.providers ?? {}).map(([key, p]) => emptyRow({
    uid: `saved:${key}`,
    key,
    baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : '',
    api: typeof p.api === 'string' ? p.api : API_OPTIONS[0],
    apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
    compat: p.compat,
    models: Array.isArray(p.models) ? p.models : [],
  }))
  const byKey = new Map(saved.map((row) => [row.key, row]))
  const builtins = BUILTIN_PROVIDERS.map((item) => {
    const existing = byKey.get(item.key)
    if (existing) {
      byKey.delete(item.key)
      return {
        ...existing,
        baseUrl: existing.baseUrl || item.baseUrl,
        api: existing.api || item.api,
      }
    }
    return emptyRow({ uid: `builtin:${item.key}`, key: item.key, baseUrl: item.baseUrl, api: item.api })
  })
  return [...builtins, ...byKey.values()]
}

function rowsToConfig(rows: ProviderRow[]): ModelsConfig {
  const providers: ModelsConfig['providers'] = {}
  for (const r of rows) {
    const key = r.key.trim()
    if (!key) continue
    if (!r.apiKey.trim() && r.models.length === 0) continue
    providers[key] = {
      ...(r.baseUrl ? { baseUrl: r.baseUrl } : {}),
      ...(r.api ? { api: r.api } : {}),
      ...(r.apiKey ? { apiKey: r.apiKey } : {}),
      ...(r.compat ? { compat: r.compat } : {}),
      models: r.models,
    }
  }
  return { providers }
}

function providerReady(row: ProviderRow): boolean {
  return Boolean(row.apiKey.trim() && row.models.some((model) => model.id.trim()))
}

export function CustomModelsEditor(): React.JSX.Element {
  const customModels = useAppStore((s) => s.customModels)
  const customModelsError = useAppStore((s) => s.customModelsError)
  const customModelsPath = useAppStore((s) => s.customModelsPath)
  const language = useAppStore((s) => s.settingsDraft.language ?? s.settings?.language ?? DEFAULT_LANGUAGE)
  const loadCustomModels = useAppStore((s) => s.loadCustomModels)
  const saveCustomModels = useAppStore((s) => s.saveCustomModels)
  const restartPi = useAppStore((s) => s.restartPi)

  const [rows, setRows] = useState<ProviderRow[]>([])
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<string[]>([])
  const [savedIndex, setSavedIndex] = useState<number | null>(null)
  const [savingIndex, setSavingIndex] = useState<number | null>(null)
  const [probing, setProbing] = useState<number | null>(null)
  const [probeMessage, setProbeMessage] = useState<{ index: number; text: string; ok: boolean } | null>(null)
  useEffect(() => {
    loadCustomModels()
  }, [loadCustomModels])

  const didOpenIncomplete = useRef(false)
  useEffect(() => {
    const next = configToRows(customModels)
    setRows(next)
    if (didOpenIncomplete.current || !customModels) return
    didOpenIncomplete.current = true
    setOpenIds(new Set(
      next
        .filter((row) => !isBuiltinProviderKey(row.key) && !providerReady(row))
        .map((row) => row.uid),
    ))
  }, [customModels])

  const update = (next: ProviderRow[]): void => {
    setRows(next)
    setSavedIndex(null)
  }

  const addProvider = (): void => {
    // Stable uid for the fold state: deriving it from the key text made the
    // fold collapse the instant the first letter was typed.
    const uid = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setOpenIds((current) => new Set([...current, uid]))
    update([...rows, emptyRow({ uid })])
  }

  const toggleOpen = (id: string): void => {
    setOpenIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const rowId = (row: ProviderRow): string => row.uid
  const removeProvider = (i: number): void => {
    if (isBuiltinProviderKey(rows[i]?.key)) return
    const next = rows.filter((_, idx) => idx !== i)
    update(next)
    void saveCustomModels(rowsToConfig(next)).then((result) => {
      if (!result.ok) setErrors(result.errors ?? [t(language, 'saveFailed')])
    })
  }

  const patchProvider = (i: number, patch: Partial<ProviderRow>): void =>
    update(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const patchProviderCompat = (i: number, patch: NonNullable<ProviderConfig['compat']>): void =>
    patchProvider(i, { compat: { ...(rows[i].compat ?? {}), ...patch } })

  const addModel = (i: number): void =>
    patchProvider(i, { models: [...rows[i].models, { id: '' }] })

  const patchModel = (pi: number, mi: number, patch: Partial<CustomModel>): void =>
    patchProvider(pi, { models: rows[pi].models.map((m, idx) => (idx === mi ? { ...m, ...patch } : m)) })

  const removeModel = (pi: number, mi: number): void =>
    patchProvider(pi, { models: rows[pi].models.filter((_, idx) => idx !== mi) })

  const mapProbeError = (error: string): string => {
    if (error === 'missing-url') return t(language, 'probeNeedUrl')
    if (error === 'missing-key') return t(language, 'probeNeedKey')
    if (error === 'shell-key') return t(language, 'probeShellKey')
    if (error === 'blocked-host' || error === 'invalid-url') return t(language, 'probeBlockedHost')
    return t(language, 'probeFailed', { error })
  }

  const runProbe = async (i: number): Promise<{ ok: true; models: Array<{ id: string; name?: string }> } | { ok: false }> => {
    const row = rows[i]
    if (!row.baseUrl.trim()) {
      setProbeMessage({ index: i, text: t(language, 'probeNeedUrl'), ok: false })
      return { ok: false }
    }
    if (!row.apiKey.trim()) {
      setProbeMessage({ index: i, text: t(language, 'probeNeedKey'), ok: false })
      return { ok: false }
    }
    if (row.apiKey.trim().startsWith('!')) {
      setProbeMessage({ index: i, text: t(language, 'probeShellKey'), ok: false })
      return { ok: false }
    }
    setProbing(i)
    setProbeMessage(null)
    try {
      const result = await window.piDesktop.models.probe({
        baseUrl: row.baseUrl,
        api: row.api,
        apiKey: row.apiKey,
      })
      if (!result.ok) {
        setProbeMessage({ index: i, text: mapProbeError(result.error), ok: false })
        return { ok: false }
      }
      return result
    } catch (err) {
      setProbeMessage({ index: i, text: t(language, 'probeFailed', { error: err instanceof Error ? err.message : String(err) }), ok: false })
      return { ok: false }
    } finally {
      setProbing(null)
    }
  }

  const testConnection = async (i: number): Promise<void> => {
    const result = await runProbe(i)
    if (!result.ok) return
    setProbeMessage({ index: i, text: t(language, 'connectionOk', { count: String(result.models.length) }), ok: true })
  }

  const probeProvider = async (i: number): Promise<void> => {
    const row = rows[i]
    const result = await runProbe(i)
    if (!result.ok) return
    const existing = new Set(row.models.map((m) => m.id.trim()).filter(Boolean))
    const merged = [...row.models.filter((m) => m.id.trim())]
    for (const model of result.models) {
      if (existing.has(model.id)) continue
      existing.add(model.id)
      merged.push(model.name ? { id: model.id, name: model.name } : { id: model.id })
    }
    patchProvider(i, { models: merged })
    setProbeMessage({ index: i, text: t(language, 'fetchedModels', { count: String(result.models.length) }), ok: true })
  }

  const handleSaveProvider = async (i: number): Promise<void> => {
    const row = rows[i]
    const key = row.key.trim()
    const localErrors: string[] = []
    if (row.apiKey.trim() || row.models.length > 0) {
      if (key.length === 0) localErrors.push(t(language, 'providerKeyRequired'))
      const otherKeys = rows
        .filter((_, idx) => idx !== i)
        .filter((r) => r.apiKey.trim() || r.models.length > 0)
        .map((r) => r.key.trim())
      if (key.length > 0 && otherKeys.includes(key)) localErrors.push(t(language, 'providerKeyUnique'))
    }
    if (localErrors.length > 0) {
      setErrors(localErrors)
      return
    }
    setSavingIndex(i)
    try {
      const result = await saveCustomModels(rowsToConfig(rows))
      if (result.ok) {
        setErrors([])
        setSavedIndex(i)
        // models.json applies on kernel restart. Restart right away when no
        // session is mid-turn, so the new model shows up in the selector
        // immediately; otherwise keep the manual restart hint.
        const state = useAppStore.getState()
        const busyTurn = Object.values(state.sessionRuntimes).some(
          (rt) => !rt.closed && (rt.activity === 'working' || rt.activity === 'needs-approval'),
        )
        if (!busyTurn) {
          void state.restartPi()
        }
      } else {
        setErrors(result.errors ?? [t(language, 'saveFailed')])
      }
    } finally {
      setSavingIndex(null)
    }
  }

  const builtinRows = useMemo(
    () => rows.map((row, index) => ({ row, index })).filter(({ row }) => isBuiltinProviderKey(row.key)),
    [rows],
  )
  const customRows = useMemo(
    () => rows.map((row, index) => ({ row, index })).filter(({ row }) => !isBuiltinProviderKey(row.key)),
    [rows],
  )

  const renderEditor = (row: ProviderRow, pi: number, builtin: boolean): React.JSX.Element => (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {!builtin && (
        <div className="grid grid-cols-2 gap-2">
          <input
            value={row.key}
            onChange={(e) => patchProvider(pi, { key: e.target.value })}
            placeholder={t(language, 'providerKeyPlaceholder')}
            className="rounded border border-border-strong bg-surface px-2 py-1 text-sm text-primary focus:border-focus focus:outline-none"
          />
          <input
            value={row.baseUrl}
            onChange={(e) => patchProvider(pi, { baseUrl: e.target.value })}
            placeholder={t(language, 'providerBaseUrl')}
            className="rounded border border-border-strong bg-surface px-2 py-1 text-sm text-primary focus:border-focus focus:outline-none"
          />
          <ThemedSelect
            value={row.api}
            onChange={(next) => patchProvider(pi, { api: next })}
            className="col-span-2"
            options={API_OPTIONS.map((opt) => ({ value: opt, label: opt }))}
          />
        </div>
      )}
      <input
        value={row.apiKey}
        onChange={(e) => patchProvider(pi, { apiKey: e.target.value })}
        placeholder={t(language, 'providerApiKey')}
        className="w-full rounded border border-border-strong bg-surface px-2 py-1 text-sm text-primary focus:border-focus focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void testConnection(pi)}
          disabled={probing === pi}
          className="flex items-center gap-1 rounded-md border border-border-strong bg-transparent px-2 py-1 text-xs text-muted transition-colors hover:border-accent-fg hover:text-primary disabled:opacity-50"
        >
          <RefreshCw size={12} className={probing === pi ? 'animate-spin' : undefined} />
          {probing === pi ? t(language, 'testingProvider') : t(language, 'testConnection')}
        </button>
        <button
          type="button"
          onClick={() => void probeProvider(pi)}
          disabled={probing === pi}
          className="flex items-center gap-1 rounded-md border border-border-strong bg-transparent px-2 py-1 text-xs text-muted transition-colors hover:border-accent-fg hover:text-primary disabled:opacity-50"
        >
          <Plus size={12} />
          {t(language, 'testFetchModels')}
        </button>
        {probeMessage?.index === pi && (
          <span className={clsx('text-xs', probeMessage.ok ? 'text-success' : 'text-error')}>
            {probeMessage.text}
          </span>
        )}
      </div>
      {row.models.map((model, mi) => (
        <div key={mi} className="rounded border border-border bg-surface/50 p-2">
          <div className="flex items-center gap-2">
            <input
              value={model.id ?? ''}
              onChange={(e) => patchModel(pi, mi, { id: e.target.value })}
              placeholder={t(language, 'modelIdPlaceholder')}
              className="flex-1 rounded border border-border-strong bg-surface px-2 py-1 text-xs text-primary focus:border-focus focus:outline-none"
            />
            <input
              value={model.name ?? ''}
              onChange={(e) => patchModel(pi, mi, { name: e.target.value })}
              placeholder={t(language, 'modelNamePlaceholder')}
              className="flex-1 rounded border border-border-strong bg-surface px-2 py-1 text-xs text-primary focus:border-focus focus:outline-none"
            />
            <button
              onClick={() => removeModel(pi, mi)}
              className="rounded p-1 text-dim hover:bg-surface-hover hover:text-error"
              title={t(language, 'removeModel')}
            >
              <Trash2 size={12} />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            <label className="flex items-center gap-1 text-[11px] text-dim">
              ctx
              <input
                type="number"
                value={model.contextWindow ?? ''}
                onChange={(e) =>
                  patchModel(pi, mi, {
                    contextWindow: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
                className="w-full rounded border border-border-strong bg-surface px-1 py-0.5 text-xs text-primary focus:border-focus focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-dim">
              max
              <input
                type="number"
                value={model.maxTokens ?? ''}
                onChange={(e) =>
                  patchModel(pi, mi, {
                    maxTokens: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
                className="w-full rounded border border-border-strong bg-surface px-1 py-0.5 text-xs text-primary focus:border-focus focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-dim">
              <input
                type="checkbox"
                checked={model.reasoning ?? false}
                onChange={(e) => patchModel(pi, mi, { reasoning: e.target.checked })}
                className="accent-accent"
              />
              {t(language, 'reasoning')}
            </label>
            <label className="flex items-center gap-1 text-[11px] text-dim">
              <input
                type="checkbox"
                checked={model.input?.includes('image') ?? false}
                onChange={(e) =>
                  patchModel(pi, mi, { input: withImageInput(model.input, e.target.checked) })
                }
                className="accent-accent"
              />
              {t(language, 'vision')}
            </label>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button
          onClick={() => addModel(pi)}
          className="flex items-center gap-1 text-xs text-muted hover:text-primary"
        >
          <Plus size={12} /> {t(language, 'addModel')}
        </button>
        {/* Save sits at the very bottom, after the model rows: the last thing
            the user edits is a model, so the action must follow the content
            instead of forcing a scroll back up. */}
        <button
          type="button"
          onClick={() => void handleSaveProvider(pi)}
          disabled={savingIndex === pi}
          className="flex items-center gap-1 rounded-md border border-accent-fg/60 bg-accent-bg/40 px-3 py-1.5 text-xs text-primary transition-colors hover:border-accent-fg hover:bg-accent-bg disabled:opacity-50"
        >
          <Save size={12} />
          {savingIndex === pi ? t(language, 'savingProvider') : t(language, 'saveModels')}
        </button>
      </div>
      {savedIndex === pi && (
        <div className="flex items-center justify-end gap-2 text-[11px] text-success">
          <span>{t(language, 'savedRestart')}</span>
          <button
            type="button"
            onClick={() => restartPi()}
            className="flex items-center gap-1 rounded-md border border-border-strong px-2 py-0.5 text-muted transition-colors hover:border-accent-fg hover:text-primary"
          >
            <RefreshCw size={11} />
            {t(language, 'restartKernel')}
          </button>
        </div>
      )}
      {!builtin && (
        <label className="flex items-center gap-2 text-[11px] text-dim">
          <input
            type="checkbox"
            checked={row.compat?.supportsReasoningEffort ?? false}
            onChange={(e) => patchProviderCompat(pi, { supportsReasoningEffort: e.target.checked })}
            className="accent-accent"
          />
          {t(language, 'supportsReasoningEffort')}
        </label>
      )}
    </div>
  )

  const renderRow = (row: ProviderRow, pi: number, builtin: boolean): React.JSX.Element => {
    const id = rowId(row)
    const open = openIds.has(id)
    const ready = providerReady(row)
    const title = builtin
      ? (BUILTIN_PROVIDERS.find((item) => item.key === row.key)?.label ?? row.key)
      : (row.key.trim() || t(language, 'addCustomProvider'))
    return (
      <div key={id} className="rounded-md border border-border">
        <button
          type="button"
          onClick={() => toggleOpen(id)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover"
        >
          <ChevronDown size={14} className={clsx('shrink-0 text-dim transition-transform', !open && '-rotate-90')} />
          <span className="min-w-0 flex-1 truncate text-sm text-primary">{title}</span>
          <span className="text-[11px] text-faint">
            {ready
              ? t(language, 'providerConfigured', { count: String(row.models.filter((model) => model.id.trim()).length) })
              : t(language, 'providerNeedsKey')}
          </span>
          {row.baseUrl.trim() && row.apiKey.trim() ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation()
                void testConnection(pi)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  void testConnection(pi)
                }
              }}
              className="rounded border border-border-strong px-1.5 py-0.5 text-[11px] text-muted hover:border-accent-fg hover:text-primary"
              title={t(language, 'testConnection')}
            >
              {probing === pi ? t(language, 'testingProvider') : t(language, 'testConnection')}
            </span>
          ) : null}
          {!builtin && (
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation()
                removeProvider(pi)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  removeProvider(pi)
                }
              }}
              className="rounded p-1 text-dim hover:bg-surface-hover hover:text-error"
              title={t(language, 'removeProvider')}
            >
              <Trash2 size={14} />
            </span>
          )}
        </button>
        {!open && probeMessage?.index === pi ? (
          <div className={clsx('px-3 pb-2 text-xs', probeMessage.ok ? 'text-success' : 'text-error')}>
            {probeMessage.text}
          </div>
        ) : null}
        {open ? <div className="px-3 pb-3">{renderEditor(row, pi, builtin)}</div> : null}
      </div>
    )
  }

  if (customModelsError) {
    return (
      <div className="flex items-start gap-2 text-sm text-warning">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <div>
          <p>{t(language, 'couldNotLoadModels')}</p>
          <p className="mt-1 text-xs text-dim">{customModelsError}</p>
          <button
            onClick={() => loadCustomModels()}
            className="mt-2 rounded border border-border-strong px-2 py-1 text-xs text-secondary hover:bg-surface-hover"
          >
            {t(language, 'retry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-dim">
        {t(language, 'modelsPathHint', { path: customModelsPath ?? '~/.omp/profiles/vespi/agent/models.json' })}
      </p>
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-dim">{t(language, 'builtinProviders')}</div>
        <p className="mb-2 text-xs text-faint">{t(language, 'builtinProvidersHint')}</p>
        <div className="space-y-2">
          {builtinRows.map(({ row, index }) => renderRow(row, index, true))}
        </div>
      </div>
      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-dim">{t(language, 'customProviders')}</div>
        <div className="space-y-2">
          {customRows.map(({ row, index }) => renderRow(row, index, false))}
        </div>
        <button
          onClick={addProvider}
          className="mt-2 flex items-center gap-1 text-sm text-muted hover:text-primary"
        >
          <Plus size={14} /> {t(language, 'addCustomProvider')}
        </button>
      </div>
      {errors.length > 0 && (
        <ul className="space-y-1 text-xs text-error">
          {errors.map((e, i) => (
            <li key={i}>• {e}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
