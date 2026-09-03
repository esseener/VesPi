import { ipcMain } from 'electron'
import type { ModelsConfig, ModelsProbeRequest, ModelsProbeResult, ModelsReadResult } from '../../shared/ipc-contracts'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { getPiCli } from '../pi-rpc-manager'
import { getOmpSessionsRoot } from '../pi-paths'
import { buildModelsYml } from '../../shared/models-yml'


export function modelsConfigPaths(): { dir: string; file: string } {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
  const root = getPiCli().kind === 'omp'
    ? dirname(getOmpSessionsRoot())
    : join(homeDir, '.pi', 'agent')
  return { dir: root, file: join(root, 'models.json') }
}

/** models.yml — OMP's authoritative provider list; written only for the OMP engine. */
function modelsYmlPath(dir: string): string {
  return join(dir, 'models.yml')
}

function resolveApiKey(apiKey: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = apiKey.trim()
  if (!trimmed) return { ok: false, error: 'missing-key' }
  if (trimmed.startsWith('$')) {
    const name = trimmed.slice(1)
    const value = process.env[name]
    if (!value) return { ok: false, error: `env-missing:${name}` }
    return { ok: true, value }
  }
  if (trimmed.startsWith('!')) return { ok: false, error: 'shell-key' }
  return { ok: true, value: trimmed }
}

function modelsUrl(baseUrl: string, api: string): string {
  const root = baseUrl.replace(/\/+$/, '')
  if (api === 'anthropic-messages') return `${root}/v1/models`
  if (api === 'google-generative-ai') {
    if (root.includes('/models')) return root
    return `${root}/models`
  }
  if (root.endsWith('/v1')) return `${root}/models`
  return `${root}/v1/models`
}

interface ListedModel {
  id: string
  name?: string
}

function parseListedModels(payload: unknown, api: string): ListedModel[] {
  if (!payload || typeof payload !== 'object') return []
  const body = payload as Record<string, unknown>
  const rows = Array.isArray(body.data)
    ? body.data
    : Array.isArray(body.models)
      ? body.models
      : Array.isArray(payload)
        ? payload
        : []
  const out: ListedModel[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const rawId = typeof item.id === 'string'
      ? item.id
      : typeof item.name === 'string'
        ? item.name
        : ''
    const id = api === 'google-generative-ai' ? rawId.replace(/^models\//, '') : rawId
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = typeof item.displayName === 'string'
      ? item.displayName
      : typeof item.name === 'string' && item.name !== id
        ? item.name
        : undefined
    out.push(name ? { id, name } : { id })
  }
  return out
}

export async function probeProviderModels(request: ModelsProbeRequest): Promise<ModelsProbeResult> {
  const baseUrl = request.baseUrl.trim()
  if (!baseUrl) return { ok: false, error: 'missing-url' }
  const key = resolveApiKey(request.apiKey)
  if (!key.ok) return { ok: false, error: key.error }
  const url = new URL(modelsUrl(baseUrl, request.api))
  if (request.api === 'google-generative-ai' && !url.searchParams.has('key')) {
    url.searchParams.set('key', key.value)
  }
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (request.api === 'anthropic-messages') {
    headers['x-api-key'] = key.value
    headers['anthropic-version'] = '2023-06-01'
  } else if (request.api !== 'google-generative-ai') {
    headers.Authorization = `Bearer ${key.value}`
  }
  const response = await fetch(url, { headers })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return { ok: false, error: `HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}` }
  }
  const payload = await response.json()
  return { ok: true, models: parseListedModels(payload, request.api) }
}


export async function readModelsConfigFile(): Promise<ModelsReadResult> {
  const { file } = modelsConfigPaths()
  if (!existsSync(file)) return { config: { providers: {} }, path: file }
  let raw: string
  try {
    raw = await readFile(file, 'utf-8')
  } catch (err) {
    return { error: `Could not read models.json: ${err instanceof Error ? err.message : String(err)}`, raw: '', path: file }
  }
  try {
    const parsed = JSON.parse(raw) as ModelsConfig
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.providers !== 'object' ||
      parsed.providers === null ||
      Array.isArray(parsed.providers)
    ) {
      return { error: 'models.json is not a valid models config (missing "providers")', raw, path: file }
    }
    return { config: parsed, path: file }
  } catch (err) {
    return { error: `models.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`, raw, path: file }
  }
}

export function registerModelsConfigHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.MODELS_READ, async (): Promise<ModelsReadResult> => {
    return readModelsConfigFile()
  })

  ipcMain.handle(IPC_CHANNELS.MODELS_WRITE, async (_event, config: unknown): Promise<{ success: boolean; error?: string }> => {
    const providers = (config as ModelsConfig | null)?.providers
    if (
      typeof config !== 'object' ||
      config === null ||
      typeof providers !== 'object' ||
      providers === null ||
      Array.isArray(providers)
    ) {
      return { success: false, error: 'Invalid models config' }
    }
    const { dir, file } = modelsConfigPaths()
    try {
      if (!existsSync(dir)) await mkdir(dir, { recursive: true })
      await writeFile(file, JSON.stringify(config, null, 2) + '\n', 'utf-8')
      // OMP ignores models.json whenever models.yml exists, so a stale yml
      // hides everything the user saves. Mirror the config into OMP's native
      // format; the Pi engine keeps reading models.json.
      if (getPiCli().kind === 'omp') {
        await writeFile(modelsYmlPath(dir), buildModelsYml(config as ModelsConfig), 'utf-8')
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC_CHANNELS.MODELS_PROBE, async (_event, request: unknown): Promise<ModelsProbeResult> => {
    if (!request || typeof request !== 'object') return { ok: false, error: 'invalid-request' }
    const body = request as Partial<ModelsProbeRequest>
    if (typeof body.baseUrl !== 'string' || typeof body.api !== 'string' || typeof body.apiKey !== 'string') {
      return { ok: false, error: 'invalid-request' }
    }
    try {
      return await probeProviderModels({ baseUrl: body.baseUrl, api: body.api, apiKey: body.apiKey })
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

