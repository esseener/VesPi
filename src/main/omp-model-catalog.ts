import type { ModelInfo } from '../shared/ipc-contracts'

/** Project OMP's CLI catalog onto the renderer contract; never expose credentials. */
export function parseOmpModelCatalog(output: string): ModelInfo[] {
  const payload = JSON.parse(output) as { models?: unknown }
  if (!Array.isArray(payload.models)) throw new Error('Invalid OMP model catalog')
  return payload.models.flatMap((row: unknown) => {
    if (!row || typeof row !== 'object') return []
    const item = row as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.provider !== 'string' || (item.kind && item.kind !== 'chat')) return []
    const cost = item.cost && typeof item.cost === 'object' ? item.cost as Record<string, unknown> : {}
    const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0
    const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
    return [{
      id: item.id,
      provider: item.provider,
      name: typeof item.name === 'string' ? item.name : item.id,
      api: typeof item.api === 'string' ? item.api : '',
      baseUrl: '',
      reasoning: item.reasoning === true,
      thinking: { efforts: strings(item.thinking) },
      input: strings(item.input),
      contextWindow: number(item.contextWindow),
      maxTokens: number(item.maxTokens),
      cost: { input: number(cost.input), output: number(cost.output), cacheRead: number(cost.cacheRead), cacheWrite: number(cost.cacheWrite) },
    }]
  })
}
