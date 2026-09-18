import { BUILTIN_PROVIDERS } from '../../shared/builtin-providers'
import type { ModelsConfig, ProviderConfig, CustomModel } from '../../shared/models-config'

/**
 * The provider editor's row model, kept apart from the component so the
 * round-trip (disk config → rows → disk config) can be tested on its own.
 *
 * The subtle rule here is what a row *omits*. Saving merges the submitted config
 * into the one on disk, and that merge only overwrites fields the submission
 * actually carries — so a cleared field has to be submitted as an explicit empty
 * string, not left out. Leaving it out is what made deleting an API key do
 * nothing: the merge read the omission as "no opinion" and put the old key back,
 * and the provider's models stayed selectable.
 */

export const API_OPTIONS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
]

export interface ProviderRow {
  /** Stable identity for the fold state; never derived from editable text. */
  uid: string
  key: string
  baseUrl: string
  api: string
  apiKey: string
  compat: ProviderConfig['compat']
  models: CustomModel[]
}

export function emptyRow(partial?: Partial<ProviderRow>): ProviderRow {
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

/** Disk config → rows. Built-in providers always appear, even with nothing saved. */
export function configToRows(config: ModelsConfig | null): ProviderRow[] {
  const saved = Object.entries(config?.providers ?? {}).map(([key, p]) =>
    emptyRow({
      uid: `saved:${key}`,
      key,
      baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : '',
      api: typeof p.api === 'string' ? p.api : API_OPTIONS[0],
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
      compat: p.compat,
      models: Array.isArray(p.models) ? p.models : [],
    })
  )
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

/**
 * Rows → the config to submit.
 *
 * `baseUrl`, `api` and `apiKey` are always emitted, empty string included: the
 * save path merges field by field, so "cleared" has to be stated. A row with
 * neither a key nor any model is dropped entirely instead, which is how clearing
 * a provider out removes it from the file.
 */
export function rowsToConfig(rows: ProviderRow[]): ModelsConfig {
  const providers: ModelsConfig['providers'] = {}
  for (const r of rows) {
    const key = r.key.trim()
    if (!key) continue
    if (!r.apiKey.trim() && r.models.length === 0) continue
    providers[key] = {
      baseUrl: r.baseUrl,
      api: r.api,
      apiKey: r.apiKey,
      ...(r.compat ? { compat: r.compat } : {}),
      models: r.models,
    }
  }
  return { providers }
}

/** A provider the editor considers ready to use: a key and at least one model id. */
export function providerReady(row: ProviderRow): boolean {
  return Boolean(row.apiKey.trim() && row.models.some((model) => model.id.trim()))
}
