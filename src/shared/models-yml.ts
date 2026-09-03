import type { ModelsConfig } from './models-config'

/**
 * Serialize the custom providers config to OMP's native `models.yml`.
 *
 * OMP treats models.yml as authoritative when it exists — models.json is
 * ignored entirely (verified against the 18.1.x kernels). VesPi must write
 * both: models.json for the Pi engine, models.yml so OMP's get_available_models
 * actually lists what the user saved.
 */

/** Double-quote every scalar; YAML then cannot misread keys, URLs, or keys with special chars. */
function yq(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Generic scalar for preserved unknown fields (flow-style JSON for arrays/objects). */
function yv(value: unknown): string {
  if (typeof value === 'string') return yq(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return yq(JSON.stringify(value))
}

const MODEL_KEYS = new Set(['id', 'name', 'api', 'reasoning', 'contextWindow', 'maxTokens', 'input'])
const PROVIDER_KEYS = new Set(['baseUrl', 'api', 'apiKey', 'compat', 'models'])

export function buildModelsYml(config: ModelsConfig): string {
  const lines: string[] = ['providers:']
  for (const [key, provider] of Object.entries(config.providers ?? {})) {
    lines.push(`  ${yq(key)}:`)
    if (provider.baseUrl) lines.push(`    baseUrl: ${yq(provider.baseUrl)}`)
    if (provider.api) lines.push(`    api: ${yq(provider.api)}`)
    if (provider.apiKey) lines.push(`    apiKey: ${yq(provider.apiKey)}`)
    for (const [extraKey, extraValue] of Object.entries(provider)) {
      if (PROVIDER_KEYS.has(extraKey) || extraValue === undefined) continue
      lines.push(`    ${extraKey}: ${yv(extraValue)}`)
    }
    if (provider.compat && Object.keys(provider.compat).length > 0) {
      lines.push('    compat:')
      for (const [compatKey, compatValue] of Object.entries(provider.compat)) {
        lines.push(`      ${compatKey}: ${compatValue ? 'true' : 'false'}`)
      }
    }
    lines.push('    models:')
    for (const model of provider.models ?? []) {
      lines.push(`      - id: ${yq(model.id)}`)
      if (model.name) lines.push(`        name: ${yq(model.name)}`)
      if (model.api) lines.push(`        api: ${yq(model.api)}`)
      if (model.reasoning !== undefined) lines.push(`        reasoning: ${model.reasoning ? 'true' : 'false'}`)
      if (model.contextWindow !== undefined) lines.push(`        contextWindow: ${model.contextWindow}`)
      if (model.maxTokens !== undefined) lines.push(`        maxTokens: ${model.maxTokens}`)
      if (model.input && model.input.length > 0) {
        lines.push('        input:')
        for (const kind of model.input) lines.push(`          - ${kind}`)
      }
      for (const [extraKey, extraValue] of Object.entries(model)) {
        if (MODEL_KEYS.has(extraKey) || extraValue === undefined) continue
        lines.push(`        ${extraKey}: ${yv(extraValue)}`)
      }
    }
  }
  return lines.join('\n') + '\n'
}
