import { test } from 'node:test'
import assert from 'node:assert/strict'
import { configToRows, rowsToConfig, providerReady, emptyRow } from './provider-rows'
import type { ModelsConfig } from '../../shared/models-config'

// The reported bug: clearing a provider's API key did nothing — the picker kept
// offering its models. Cause: the row layer left cleared fields OUT of the
// submitted config, and the save path merges field by field, so an omission
// reads as "no opinion" and the old key came back from disk. These lock in that
// cleared fields are stated explicitly instead.

const keyed: ModelsConfig = {
  providers: {
    a6api: {
      baseUrl: 'https://example.test/v1',
      api: 'openai-completions',
      apiKey: 'sk-secret',
      models: [{ id: 'grok-4.6', name: 'Grok' }] as never,
    },
  },
}

test('a cleared API key is submitted as an explicit empty string', () => {
  const rows = configToRows(keyed)
  const row = rows.find((r) => r.key === 'a6api')
  assert.ok(row, 'the provider is on screen')
  row.apiKey = ''

  const submitted = rowsToConfig([row])

  assert.ok(submitted.providers.a6api, 'the provider is still submitted — its models are kept')
  assert.equal(
    submitted.providers.a6api.apiKey,
    '',
    'the empty key has to be present, or the merge on the save path restores the old one'
  )
  assert.equal(submitted.providers.a6api.baseUrl, 'https://example.test/v1', 'other fields survive')
  assert.equal(submitted.providers.a6api.models?.length, 1, 'the model list is untouched')
})

test('clearing a provider completely removes it from the submitted config', () => {
  const rows = configToRows(keyed)
  const row = rows.find((r) => r.key === 'a6api')
  assert.ok(row)
  row.apiKey = ''
  row.models = []

  const submitted = rowsToConfig([row])

  assert.equal(submitted.providers.a6api, undefined, 'no key and no models means "remove it"')
})

test('a round trip keeps the provider as it was', () => {
  const rows = configToRows(keyed)
  const submitted = rowsToConfig(rows)

  assert.deepEqual(submitted.providers.a6api, keyed.providers.a6api)
})

test('untouched built-in providers are not written to disk', () => {
  // configToRows always shows the built-ins so they can be filled in; submitting
  // one the user never touched would write a provider entry with no key.
  const rows = configToRows(null)
  assert.ok(rows.length > 0, 'built-ins are listed')

  const submitted = rowsToConfig(rows)

  assert.deepEqual(submitted.providers, {}, 'nothing is saved for providers with no key and no models')
})

test('a row without a key is not "ready"', () => {
  const row = emptyRow({ key: 'p', apiKey: 'sk-x', models: [{ id: 'm' }] as never })
  assert.equal(providerReady(row), true)
  assert.equal(providerReady({ ...row, apiKey: '   ' }), false, 'whitespace is not a key')
  assert.equal(providerReady({ ...row, models: [] }), false, 'a key with no model is not usable yet')
})
