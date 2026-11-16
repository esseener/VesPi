import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parse } from 'yaml'
import { patchOmpConfigText } from './omp-profile-config'

test('model changes preserve comments, lists, nested maps and quoted hashes', () => {
  const text = '# user configuration\nsetupVersion: 9\nmodelRoles:\n  default: old/model\n  smol: fast/model\ntools:\n  allowed: [read, write]\n  nested:\n    label: "hello # world"\n'
  const updated = patchOmpConfigText(text, { defaultModel: 'provider/new', thinkingLevel: 'high' })
  assert.ok(updated.includes('# user configuration'))
  assert.deepEqual(parse(updated), {
    setupVersion: 9,
    modelRoles: { default: 'provider/new', smol: 'fast/model' },
    tools: { allowed: ['read', 'write'], nested: { label: 'hello # world' } },
    defaultThinkingLevel: 'high',
  })
})

test('thinking changes use the native OMP key without resetting appearance or other thinking options', () => {
  const text = 'theme:\n  dark: dracula\nsymbolPreset: ascii\nthinking:\n  defaultLevel: low\n  custom: keep\n'
  const result = parse(patchOmpConfigText(text, { thinkingLevel: 'max' }))
  assert.equal(result.defaultThinkingLevel, 'max')
  assert.deepEqual(result.theme, { dark: 'dracula' })
  assert.equal(result.symbolPreset, 'ascii')
  assert.deepEqual(result.thinking, { custom: 'keep' })
})

test('invalid config is rejected before any write can replace it', () => {
  assert.throws(() => patchOmpConfigText('{}', { thinkingLevel: 'invalid' }), /Invalid OMP thinkingLevel/)
  assert.throws(() => patchOmpConfigText('{}', { interruptMode: 'later' }), /Invalid OMP interruptMode/)
  assert.throws(() => patchOmpConfigText('tools: [broken', { defaultModel: 'a/b' }), /Invalid OMP config/)
  assert.throws(() => patchOmpConfigText('- list', { defaultModel: 'a/b' }), /mapping/)
  assert.deepEqual(parse(patchOmpConfigText('', { defaultModel: 'a/b' })), { modelRoles: { default: 'a/b' } })
})

test('behavior settings map onto native OMP keys including explicit false', () => {
  const result = parse(patchOmpConfigText('hideThinkingBlock: true\nplan:\n  enabled: true\n', {
    hideThinkingBlock: false, steeringMode: 'all', followUpMode: 'one-at-a-time', interruptMode: 'wait',
  }))
  assert.deepEqual(result, { hideThinkingBlock: false, plan: { enabled: true }, steeringMode: 'all', followUpMode: 'one-at-a-time', interruptMode: 'wait' })
})
