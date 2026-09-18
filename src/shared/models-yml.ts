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

/**
 * Whether a provider may be emitted at all.
 *
 * OMP validates the whole file and rejects it wholesale — not per provider —
 * when a custom provider declares models without a key:
 *
 *   Validate(models) error: Provider <name>: "apiKey" is required when
 *   defining custom models unless auth is "none" or "oauth".
 *
 * The kernel then reports "No models available" and every provider loses its
 * models, not just the offending one. A provider the user emptied still sits in
 * models.json carrying its models array (that is how the editor keeps the row
 * on screen so the key can be retyped), so without this guard, clearing one
 * key would take the user's entire model list down until the row was deleted.
 *
 * `auth: none` and `auth: oauth` are the kernel's documented escape hatches for
 * genuinely keyless providers, so those are left alone.
 */
function providerIsLoadable(provider: ModelsConfig['providers'][string]): boolean {
  const auth = typeof provider.auth === 'string' ? provider.auth.trim() : ''
  if (auth === 'none' || auth === 'oauth') return true
  if (typeof provider.apiKey === 'string' && provider.apiKey.trim().length > 0) return true
  // No usable key: it may only stay if it declares no models, which the kernel
  // accepts (it is simply a provider with nothing to offer).
  return (provider.models ?? []).length === 0
}

export function buildModelsYml(config: ModelsConfig): string {
  const lines: string[] = ['providers:']
  for (const [key, provider] of Object.entries(config.providers ?? {})) {
    if (!providerIsLoadable(provider)) continue
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
