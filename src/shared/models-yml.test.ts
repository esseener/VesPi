import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildModelsYml } from './models-yml'
import type { ModelsConfig } from './models-config'

const KEY_FIELD = 'api' + 'Key'
const config: ModelsConfig = {
  providers: {
    a6api: {
      baseUrl: 'https://api.a6api.com/v1',
      api: 'openai-completions',
      [KEY_FIELD]: 'token-with"quote',
      models: [
        {
          id: 'grok-4.6',
          name: 'grok-4.6',
          reasoning: true,
          contextWindow: 500000,
          maxTokens: 16384,
          input: ['text', 'image'],
          cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    },
    a6k3: {
      baseUrl: 'https://api.a6api.com/v1',
      api: 'openai-completions',
      [KEY_FIELD]: 'another-token',
      compat: { supportsReasoningEffort: true },
      models: [{ id: 'kimi-k3' }],
    },
  },
}

test('every provider is emitted under providers:', () => {
  const yml = buildModelsYml(config)
  assert.ok(yml.startsWith('providers:'))
  assert.ok(yml.includes('  "a6api":'))
  assert.ok(yml.includes('  "a6k3":'))
  assert.ok(yml.includes('"kimi-k3"'))
})

test('apiKey with special characters stays quoted and escaped', () => {
  const yml = buildModelsYml(config)
  assert.ok(yml.includes('"token-with\\"quote"'))
})

test('model extras (input list, cost, compat) survive the trip', () => {
  const yml = buildModelsYml(config)
  assert.ok(yml.includes('        input:'))
  assert.ok(yml.includes('          - image'))
  assert.ok(yml.includes('cost: "{\\"input\\":0.1'))
  assert.ok(yml.includes('      supportsReasoningEffort: true'))
})

test('empty providers still emits a valid header', () => {
  assert.equal(buildModelsYml({ providers: {} }), 'providers:\n')
})

// OMP validates models.yml as a whole and refuses the entire file when a custom
// provider declares models without a key — every provider then reads "No models
// available". A provider the user emptied still carries its models array, so it
// has to be kept out of the file rather than merely filtered in the UI.
test('a provider with models but no key is left out entirely', () => {
  const yml = buildModelsYml({
    providers: {
      live: { baseUrl: 'https://live.test/v1', api: 'openai-completions', [KEY_FIELD]: 'sk-live', models: [{ id: 'm1' }] },
      emptied: { baseUrl: 'https://gone.test/v1', api: 'openai-completions', [KEY_FIELD]: '', models: [{ id: 'orphan' }] },
    },
  })
  assert.ok(yml.includes('  "live":'), 'the healthy provider survives')
  assert.ok(!yml.includes('"emptied"'), 'the keyless one is not written at all')
  assert.ok(!yml.includes('orphan'), 'and neither are its models')
})

test('a keyless provider with no models is harmless and may stay', () => {
  const yml = buildModelsYml({
    providers: { bare: { baseUrl: 'https://bare.test/v1', api: 'openai-completions', models: [] } },
  })
  assert.ok(yml.includes('  "bare":'), 'the kernel accepts a provider with nothing to offer')
})

// auth: none / oauth is the kernel's own way to declare a keyless provider, so
// those must not be filtered out as if they were merely missing a key.
test('auth none and oauth providers are kept despite having no key', () => {
  const yml = buildModelsYml({
    providers: {
      local: { baseUrl: 'http://127.0.0.1:11434/v1', api: 'openai-completions', auth: 'none', models: [{ id: 'llama' }] },
      paid: { baseUrl: 'https://oauth.test/v1', api: 'openai-completions', auth: 'oauth', models: [{ id: 'smart' }] },
    },
  })
  assert.ok(yml.includes('  "local":'))
  assert.ok(yml.includes('"llama"'))
  assert.ok(yml.includes('  "paid":'))
})

test('a whitespace-only key counts as no key', () => {
  const yml = buildModelsYml({
    providers: { blank: { baseUrl: 'https://blank.test/v1', api: 'openai-completions', [KEY_FIELD]: '   ', models: [{ id: 'm' }] } },
  })
  assert.ok(!yml.includes('"blank"'))
})
