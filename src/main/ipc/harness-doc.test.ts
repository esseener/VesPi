import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { APPEND_SYSTEM_PROMPT_FLAG, hasArgFlag, withHarnessDoc } from './harness-doc'

const DOC = 'C:\\VesPi\\resources\\vespi-harness.md'
const always = () => true
const never = () => false

describe('hasArgFlag', () => {
  it('matches the separated form and the equals form', () => {
    assert.equal(hasArgFlag(['--append-system-prompt', 'x'], '--append-system-prompt'), true)
    assert.equal(hasArgFlag(['--append-system-prompt=x'], '--append-system-prompt'), true)
  })

  it('does not match a different flag or a longer name', () => {
    assert.equal(hasArgFlag(['--system-prompt', 'x'], '--append-system-prompt'), false)
    assert.equal(hasArgFlag(['--append-system-prompts=x'], '--append-system-prompt'), false)
    assert.equal(hasArgFlag([], '--append-system-prompt'), false)
  })
})

describe('withHarnessDoc', () => {
  it('appends the shell-context document when it is on disk', () => {
    assert.deepEqual(withHarnessDoc(['--tools', 'read', '-e', 'ext.ts'], DOC, always), [
      '--tools',
      'read',
      '-e',
      'ext.ts',
      APPEND_SYSTEM_PROMPT_FLAG,
      DOC,
    ])
  })

  it('appends nothing when no document path was resolved', () => {
    assert.deepEqual(withHarnessDoc(['--tools', 'read'], null, always), ['--tools', 'read'])
  })

  // The kernel reads an unreadable value as literal inline text, so passing a
  // missing path would inject the path itself into the system prompt.
  it('appends nothing when the document is missing', () => {
    assert.deepEqual(withHarnessDoc(['--tools', 'read'], DOC, never), ['--tools', 'read'])
    assert.deepEqual(
      withHarnessDoc(['--tools', 'read'], join('C:', 'definitely', 'absent', 'vespi-harness.md')),
      ['--tools', 'read'],
    )
  })

  it('leaves an explicit caller override alone', () => {
    const separated = ['--append-system-prompt', 'my own text']
    assert.deepEqual(withHarnessDoc(separated, DOC, always), separated)
    const equals = ['--append-system-prompt=my own text']
    assert.deepEqual(withHarnessDoc(equals, DOC, always), equals)
  })

  it('does not mutate the array it was given', () => {
    const args = ['--tools', 'read']
    withHarnessDoc(args, DOC, always)
    assert.deepEqual(args, ['--tools', 'read'])
  })

  it('is idempotent, so a start can be re-applied without stacking the flag', () => {
    const once = withHarnessDoc(['--tools', 'read'], DOC, always)
    assert.deepEqual(withHarnessDoc(once, DOC, always), once)
  })
})

// Guard against the feature dying silently: a renamed or emptied document
// makes withHarnessDoc a no-op and no other test would notice.
describe('the shipped shell-context document', () => {
  function findDoc(): string | null {
    let dir = process.cwd()
    for (let depth = 0; depth < 5; depth += 1) {
      const candidate = join(dir, 'resources', 'vespi-harness.md')
      if (existsSync(candidate)) return candidate
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return null
  }

  it('exists and is not empty', () => {
    const doc = findDoc()
    assert.ok(doc, 'resources/vespi-harness.md was not found from the test working directory')
    assert.ok(statSync(doc).size > 1000, 'the shell-context document looks truncated')
  })
})
