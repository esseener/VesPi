import assert from 'node:assert/strict'
import { test } from 'node:test'
import { probeProviderModels, resolvedStartModel } from './models-config-handlers'

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

test('probeProviderModels refuses localhost and private hosts', async () => {
  const local = await probeProviderModels({
    baseUrl: 'http://127.0.0.1:11434',
    api: 'openai-completions',
    apiKey: 'dummy',
  })
  assert.deepEqual(local, { ok: false, error: 'blocked-host' })
  const privateLan = await probeProviderModels({
    baseUrl: 'http://192.168.1.10/v1',
    api: 'openai-completions',
    apiKey: 'dummy',
  })
  assert.deepEqual(privateLan, { ok: false, error: 'blocked-host' })
  const fileUrl = await probeProviderModels({
    baseUrl: 'file:///etc/passwd',
    api: 'openai-completions',
    apiKey: 'dummy',
  })
  assert.deepEqual(fileUrl, { ok: false, error: 'invalid-url' })
})

test('resolvedStartModel drops a deleted provider instead of killing OMP', () => {
  const config = { providers: { a6api: { models: [{ id: 'grok-4.6' }] } } }
  assert.deepEqual(
    resolvedStartModel({ defaultProvider: 'a6claude4.8', defaultModel: 'claude-opus-4-8' }, config),
    {},
  )
  assert.deepEqual(
    resolvedStartModel({ defaultProvider: 'a6api', defaultModel: 'grok-4.6' }, config),
    { provider: 'a6api', model: 'grok-4.6' },
  )
  assert.deepEqual(
    resolvedStartModel({ defaultProvider: 'a6api', defaultModel: 'missing' }, config),
    { provider: 'a6api' },
  )
})
