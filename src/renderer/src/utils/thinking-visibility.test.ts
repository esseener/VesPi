import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { liveThinkingStartsExpanded } from './thinking-visibility'

describe('liveThinkingStartsExpanded', () => {
  it('keeps a streaming turn’s thinking collapsed until the user opens it', () => {
    // The complaint this answers: with Show Thinking on, a live turn poured its
    // whole reasoning chain above the answer, then collapsed as soon as the turn
    // committed — expanded when unwanted, collapsed when wanted.
    assert.equal(liveThinkingStartsExpanded(), false)
  })
})
