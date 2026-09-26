import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectiveThinkingLevel, thinkingSupport } from './thinking-levels'

test('a non-reasoning model offers nothing, and the kernel would refuse it', () => {
  const model = { reasoning: false }
  assert.deepEqual(thinkingSupport(model), { kind: 'unsupported' })
  assert.equal(effectiveThinkingLevel(model, 'high'), null)
})

test('reasoning with no declared efforts is its own state, not an empty menu of levels', () => {
  // The case that made the old menu a fiction: the kernel knows the model thinks
  // but not which levels it takes, so every level it would offer does nothing.
  const model = { reasoning: true, thinking: {} }
  assert.deepEqual(thinkingSupport(model), { kind: 'undeclared' })
  assert.equal(effectiveThinkingLevel(model, 'high'), null)
})

test('a declared list becomes the menu, lowest first, with off in front', () => {
  // DeepSeek's flash models declare exactly these, out of canonical order.
  const model = { reasoning: true, thinking: { efforts: ['max', 'low', 'high'] } }
  assert.deepEqual(thinkingSupport(model), { kind: 'levels', levels: ['off', 'low', 'high', 'max'] })
})

test('a level the model does not declare rounds down, as the kernel does', () => {
  // 17*23 needs "medium" thinking on a model that only goes low/high/max: the
  // kernel resolves that to low, so the menu must not keep claiming medium.
  const model = { reasoning: true, thinking: { efforts: ['low', 'high', 'max'] } }
  assert.equal(effectiveThinkingLevel(model, 'medium'), 'low')
  assert.equal(effectiveThinkingLevel(model, 'xhigh'), 'high')
})

test('below the lowest declared level it collapses onto that lowest', () => {
  const model = { reasoning: true, thinking: { efforts: ['high', 'max'] } }
  assert.equal(effectiveThinkingLevel(model, 'minimal'), 'high')
  assert.equal(effectiveThinkingLevel(model, 'low'), 'high')
})

test('a declared level is returned untouched, including off', () => {
  const model = { reasoning: true, thinking: { efforts: ['low', 'high'] } }
  assert.equal(effectiveThinkingLevel(model, 'low'), 'low')
  assert.equal(effectiveThinkingLevel(model, 'high'), 'high')
  assert.equal(effectiveThinkingLevel(model, 'off'), 'off')
})

test('levels the kernel does not know are ignored rather than offered', () => {
  const model = { reasoning: true, thinking: { efforts: ['low', 'bogus', 'high'] } }
  assert.deepEqual(thinkingSupport(model), { kind: 'levels', levels: ['off', 'low', 'high'] })
  assert.equal(effectiveThinkingLevel(model, 'bogus'), null)
})

test('a missing model is handled without pretending', () => {
  assert.deepEqual(thinkingSupport(null), { kind: 'unsupported' })
  assert.equal(effectiveThinkingLevel(undefined, 'high'), null)
})
