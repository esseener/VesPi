import assert from 'node:assert/strict'
import test from 'node:test'
import {
  commandDisplayDescription,
  commandDisplayLabel,
  commandSourceLabel,
} from './command-display'

test('Chinese display name for known commands', () => {
  assert.equal(commandDisplayLabel('compact', 'zh'), '压缩上下文')
  assert.equal(commandDisplayLabel('/model', 'zh'), '切换模型')
  assert.equal(commandDisplayLabel('skill:goal', 'zh'), '目标')
})

test('unknown command keeps the raw name', () => {
  assert.equal(commandDisplayLabel('totally-new-omp-cmd', 'zh'), 'totally-new-omp-cmd')
})

test('description prefers the Chinese table then falls back', () => {
  assert.equal(commandDisplayDescription('export', 'Export HTML report', 'zh'), '导出本回合报告')
  assert.equal(
    commandDisplayDescription('mystery', 'Do something', 'zh'),
    'Do something',
  )
})

test('source badges localize', () => {
  assert.equal(commandSourceLabel('skill', 'zh'), '技能')
  assert.equal(commandSourceLabel('builtin', 'zh'), '命令')
  assert.equal(commandSourceLabel('plugin', 'zh'), 'plugin')
})
