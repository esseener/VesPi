import assert from 'node:assert/strict'
import { test } from 'node:test'
import { probeProviderModels } from './models-config-handlers'

test('probeProviderModels requires a base URL', async () => {
  const result = await probeProviderModels({ baseUrl: '  ', api: 'openai-completions', apiKey: 'sk-test' })
  assert.deepEqual(result, { ok: false, error: 'missing-url' })
})

test('probeProviderModels requires an API key', async () => {
  const result = await probeProviderModels({ baseUrl: 'https://api.openai.com/v1', api: 'openai-completions', apiKey: '' })
  assert.deepEqual(result, { ok: false, error: 'missing-key' })
})

test('probeProviderModels refuses shell-command keys', async () => {
  const result = await probeProviderModels({
    baseUrl: 'https://api.openai.com/v1',
    api: 'openai-completions',
    apiKey: '!op read openai',
  })
  assert.deepEqual(result, { ok: false, error: 'shell-key' })
})
