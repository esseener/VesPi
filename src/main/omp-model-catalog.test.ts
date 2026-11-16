import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseOmpModelCatalog } from './omp-model-catalog'

test('native catalog retains model capabilities and excludes non-chat models and secrets', () => {
  const models = parseOmpModelCatalog(JSON.stringify({ models: [
    { kind: 'chat', provider: 'custom', id: 'reasoner', reasoning: true, thinking: ['low', 'high', 'max'], contextWindow: 500000, maxTokens: 320000, input: ['text', 'image'], apiKey: 'never-return', cost: { input: 2, output: 6 } },
    { kind: 'embedding', provider: 'custom', id: 'embed' },
    null,
  ] }))
  assert.equal(models.length, 1)
  assert.equal(models[0].contextWindow, 500000)
  assert.equal(models[0].reasoning, true)
  assert.deepEqual(models[0].thinking?.efforts, ['low', 'high', 'max'])
  assert.deepEqual(models[0].input, ['text', 'image'])
  assert.ok(!JSON.stringify(models).includes('never-return'))
})

test('invalid catalog is an error rather than a successful empty list', () => {
  assert.throws(() => parseOmpModelCatalog('{}'), /Invalid OMP/)
  assert.throws(() => parseOmpModelCatalog('warning'), SyntaxError)
})
