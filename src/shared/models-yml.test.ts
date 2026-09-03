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
