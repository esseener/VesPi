import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractVersionLine } from './version-output'

test('extractVersionLine takes the first non-empty line', () => {
  assert.equal(extractVersionLine('0.31.0\n'), '0.31.0')
  assert.equal(extractVersionLine('\n  pi 0.31.0 \nextra noise'), 'pi 0.31.0')
  assert.equal(extractVersionLine('   '), null)
  assert.equal(extractVersionLine(''), null)
})
