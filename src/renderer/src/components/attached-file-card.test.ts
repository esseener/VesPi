import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import { AttachedFileCard } from './attached-file-card'

/**
 * Rendered rather than inspected: the whole point of the card is that the
 * transcript no longer contains the file, so "the body is absent from the
 * markup" is the assertion that matters, and only a render can make it.
 *
 * Expected strings come from `t()` itself, so the test does not encode a
 * language — it checks that the label the card is supposed to show is the one
 * on screen.
 */
function render(file: Parameters<typeof AttachedFileCard>[0]['file']): string {
  return renderToStaticMarkup(createElement(AttachedFileCard, { file }))
}

function lineLabel(count: number): string {
  return t(DEFAULT_LANGUAGE, 'attachedFileLines', { count: String(count) })
}

test('a collapsed card names the file and withholds its body', () => {
  const markup = render({ name: 'notes.md', content: '# Title\n\nBODY_SENTINEL_LINE' })

  assert.match(markup, /notes\.md/, 'the name is what the reader recognises it by')
  assert.ok(markup.includes(lineLabel(3)), 'and a size hint, so it is clear how big it is')
  assert.ok(!markup.includes('BODY_SENTINEL_LINE'), 'the file body must not be in the transcript')
  assert.match(markup, /aria-expanded="false"/)
  assert.ok(
    markup.includes(t(DEFAULT_LANGUAGE, 'attachedFileShow')),
    'and the control announces that the file can be opened'
  )
})

test('a single-line file does not claim to have zero lines', () => {
  assert.ok(render({ name: 'one.txt', content: 'just one line' }).includes(lineLabel(1)))
  assert.ok(render({ name: 'empty.txt', content: '' }).includes(lineLabel(0)))
})

test('the name cannot break out of its slot', () => {
  // Long names truncate rather than stretching the bubble the card sits in.
  const markup = render({ name: 'a'.repeat(200) + '.md', content: 'x' })
  assert.match(markup, /truncate/)
  assert.match(markup, /aria-expanded="false"/)
})
