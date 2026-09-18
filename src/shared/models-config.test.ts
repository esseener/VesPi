import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  validateModelsConfig,
  mergeModelsConfig,
  normalizeModelsConfigForPi,
  withImageInput,
  isProviderRetired,
  type ModelsConfig,
} from './models-config'

test('empty config is valid', () => {
  assert.deepEqual(validateModelsConfig({ providers: {} }), [])
})

test('flags empty provider key', () => {
  const errs = validateModelsConfig({ providers: { '': { models: [{ id: 'a' }] } } })
  assert.ok(errs.some((e) => e.toLowerCase().includes('provider')))
})

test('flags model with empty id', () => {
  const errs = validateModelsConfig({ providers: { p: { models: [{ id: '' }] } } })
  assert.ok(errs.some((e) => e.toLowerCase().includes('id')))
})

test('flags duplicate model id within a provider', () => {
  const errs = validateModelsConfig({
    providers: { p: { models: [{ id: 'x' }, { id: 'x' }] } },
  })
  assert.ok(errs.some((e) => e.toLowerCase().includes('duplicate')))
})

test('flags non-finite numeric field', () => {
  const errs = validateModelsConfig({
    providers: { p: { models: [{ id: 'x', contextWindow: Number.NaN }] } },
  })
  assert.ok(errs.some((e) => e.toLowerCase().includes('contextwindow')))
})

test('merge preserves unknown top-level, provider, and model fields', () => {
  const original: ModelsConfig = {
    $schema: 'https://x',
    providers: {
      p: {
        baseUrl: 'http://old',
        authHeader: true,
        compat: { supportsDeveloperRole: false },
        models: [{ id: 'm', thinkingLevelMap: { high: 'max' }, contextWindow: 1000 }],
      },
    },
  } as ModelsConfig
  const edited: ModelsConfig = {
    providers: { p: { baseUrl: 'http://new', models: [{ id: 'm', contextWindow: 2000 }] } },
  }
  const merged = mergeModelsConfig(original, edited)
  assert.equal((merged as Record<string, unknown>).$schema, 'https://x')
  assert.equal(merged.providers.p.baseUrl, 'http://new')
  assert.equal(merged.providers.p.authHeader, true)
  assert.deepEqual(merged.providers.p.compat, { supportsDeveloperRole: false })
  assert.equal(merged.providers.p.models![0].contextWindow, 2000)
  assert.deepEqual(merged.providers.p.models![0].thinkingLevelMap, { high: 'max' })
})

test('merge adds new and drops removed providers/models', () => {
  const original: ModelsConfig = {
    providers: { keep: { models: [{ id: 'a' }, { id: 'gone' }] }, drop: {} },
  }
  const edited: ModelsConfig = {
    providers: { keep: { models: [{ id: 'a' }] }, fresh: { models: [{ id: 'b' }] } },
  }
  const merged = mergeModelsConfig(original, edited)
  assert.deepEqual(Object.keys(merged.providers).sort(), ['fresh', 'keep'])
  assert.deepEqual(merged.providers.keep.models!.map((m) => m.id), ['a'])
})

test('normalizes Ollama Cloud reasoning effort support for thinking models', () => {
  const normalized = normalizeModelsConfigForPi({
    providers: {
      'ollama-cloud': {
        baseUrl: 'https://ollama.com/v1',
        api: 'openai-completions',
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: true,
        },
        models: [
          {
            id: 'glm-5.2:cloud',
            reasoning: true,
          },
        ],
      },
    },
  })

  assert.equal(normalized.providers['ollama-cloud'].compat?.supportsReasoningEffort, true)
  assert.equal(normalized.providers['ollama-cloud'].compat?.supportsDeveloperRole, false)
  assert.equal(normalized.providers['ollama-cloud'].compat?.supportsUsageInStreaming, true)
})

test('withImageInput enables image while keeping text', () => {
  assert.deepEqual(withImageInput(['text'], true), ['text', 'image'])
})

test('withImageInput defaults missing input to text before enabling image', () => {
  assert.deepEqual(withImageInput(undefined, true), ['text', 'image'])
})

test('withImageInput is idempotent when image already present', () => {
  assert.deepEqual(withImageInput(['text', 'image'], true), ['text', 'image'])
})

test('withImageInput removes image but keeps text when disabled', () => {
  assert.deepEqual(withImageInput(['text', 'image'], false), ['text'])
})

test('withImageInput keeps text when disabling on a text-only model', () => {
  assert.deepEqual(withImageInput(['text'], false), ['text'])
})

test('withImageInput adds missing text for an image-only input', () => {
  assert.deepEqual(withImageInput(['image'], true), ['text', 'image'])
  assert.deepEqual(withImageInput(['image'], false), ['text'])
})

// The kernel reads models.yml once at startup and serves that list until it is
// restarted, so after any config edit the picker sees models for providers the
// user already dealt with. Both ways of retiring a provider have to be caught:
// clearing its key leaves a row behind, deleting it removes the row entirely.
test('a provider whose key was cleared counts as retired', () => {
  const config: ModelsConfig = {
    providers: { cleared: { baseUrl: 'https://example.test/v1', apiKey: '', models: [] }, live: { baseUrl: 'https://example.test/v1', apiKey: 'sk-x', models: [] } },
  }
  assert.equal(isProviderRetired(config, 'cleared'), true)
  assert.equal(isProviderRetired(config, 'live'), false)
})

// VesPi owns models.json/models.yml, so the kernel offers nothing they do not
// contain (verified against 18.2.5). A provider missing from the config was
// deleted by the user, and its stale models must not survive in the picker —
// this is the case that made "I deleted it and it is still there" possible.
test('a provider the config no longer carries counts as retired', () => {
  const config: ModelsConfig = {
    providers: { live: { baseUrl: 'https://example.test/v1', apiKey: 'sk-x', models: [] } },
  }
  assert.equal(isProviderRetired(config, 'deleted'), true)
  assert.equal(isProviderRetired({ providers: {} }, 'deleted'), true)
})

// An unreadable config is not an empty one: retiring everything would leave the
// user staring at an empty model menu because a file momentarily failed to load.
test('an unreadable config retires nothing', () => {
  assert.equal(isProviderRetired(null, 'anything'), false)
  assert.equal(isProviderRetired(undefined, 'anything'), false)
})

test('a blank provider name retires nothing', () => {
  const config: ModelsConfig = { providers: { live: { apiKey: 'sk-x', models: [] } } }
  assert.equal(isProviderRetired(config, ''), false)
  assert.equal(isProviderRetired(config, '   '), false)
})

test('a command-provided key is not treated as usable', () => {
  const config: ModelsConfig = {
    providers: { shell: { baseUrl: 'https://example.test/v1', apiKey: '!op read op://vault/key', models: [] } },
  }
  assert.equal(isProviderRetired(config, 'shell'), true)
})
