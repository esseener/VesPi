import { test } from 'node:test'
import assert from 'node:assert/strict'
import { configToRows, rowsToConfig, providerReady, emptyRow } from './provider-rows'
import { isProviderRetired, mergeModelsConfig } from '../../shared/models-config'
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

// The follow-up report: deleting a provider in settings still left its models in
// the composer's picker. The kernel reads models.yml once at startup, so it kept
// serving the deleted provider until the app restarted — and the picker only
// knew how to spot a *cleared key*, so a provider removed from the file outright
// slipped through as "unknown, not our business". These walk the two journeys a
// user actually takes and assert the picker's rule retires the provider in both.
test('deleting a provider retires it, even though the kernel still lists it', () => {
  const onDisk: ModelsConfig = {
    providers: {
      live: { baseUrl: 'https://keep.test/v1', api: 'openai-completions', apiKey: 'sk-live', models: [{ id: 'm1' }] as never },
      doomed: { baseUrl: 'https://gone.test/v1', api: 'openai-completions', apiKey: 'sk-gone', models: [{ id: 'claude-opus-5' }] as never },
    },
  }
  const rows = configToRows(onDisk).filter((row) => row.key !== 'doomed')
  const written = mergeModelsConfig(onDisk, rowsToConfig(rows))

  assert.ok(!('doomed' in written.providers), 'the row is gone from the file')

  // What the kernel still answers with, having loaded the file before the edit.
  const kernelOffer = ['live', 'doomed']
  assert.deepEqual(
    kernelOffer.filter((provider) => !isProviderRetired(written, provider)),
    ['live'],
    'only the surviving provider is offered',
  )
})

test('clearing a key retires the provider while its row is still on screen', () => {
  const onDisk: ModelsConfig = {
    providers: {
      live: { baseUrl: 'https://keep.test/v1', api: 'openai-completions', apiKey: 'sk-live', models: [{ id: 'm1' }] as never },
      emptied: { baseUrl: 'https://gone.test/v1', api: 'openai-completions', apiKey: 'sk-old', models: [{ id: 'x1' }] as never },
    },
  }
  const rows = configToRows(onDisk)
  rows.find((row) => row.key === 'emptied')!.apiKey = ''
  const written = mergeModelsConfig(onDisk, rowsToConfig(rows))

  assert.equal(written.providers.emptied?.apiKey, '', 'the cleared key really is written')

  const kernelOffer = ['live', 'emptied']
  assert.deepEqual(
    kernelOffer.filter((provider) => !isProviderRetired(written, provider)),
    ['live'],
    'the emptied provider stops being offered, models and all',
  )
})

test('editing one provider leaves the others offered', () => {
  // Guard against over-filtering: a delete must not retire the providers the
  // user never touched, which is the tempting way to make the test above pass.
  const onDisk: ModelsConfig = {
    providers: {
      keepA: { baseUrl: 'https://a.test/v1', api: 'openai-completions', apiKey: 'sk-a', models: [{ id: 'm1' }] as never },
      keepB: { baseUrl: 'https://b.test/v1', api: 'openai-completions', apiKey: 'sk-b', models: [{ id: 'm2' }] as never },
      doomed: { baseUrl: 'https://c.test/v1', api: 'openai-completions', apiKey: 'sk-c', models: [{ id: 'm3' }] as never },
    },
  }
  const rows = configToRows(onDisk).filter((row) => row.key !== 'doomed')
  const written = mergeModelsConfig(onDisk, rowsToConfig(rows))

  assert.deepEqual(
    ['keepA', 'keepB', 'doomed'].filter((provider) => !isProviderRetired(written, provider)),
    ['keepA', 'keepB'],
  )
})
