import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { formatGoalTime, formatTokenCount, goalActions, goalStatusKey } from './goal-display'

describe('formatTokenCount', () => {
  it('shows small counts as-is', () => {
    assert.equal(formatTokenCount(0), '0')
    assert.equal(formatTokenCount(940), '940')
    assert.equal(formatTokenCount(999), '999')
  })

  it('shortens thousands so the strip never reflows', () => {
    assert.equal(formatTokenCount(1000), '1.0k')
    assert.equal(formatTokenCount(16920), '16.9k')
    assert.equal(formatTokenCount(169999), '170k')
  })

  it('survives values the kernel should never send', () => {
    assert.equal(formatTokenCount(-5), '0')
    assert.equal(formatTokenCount(Number.NaN), '0')
  })
})

describe('formatGoalTime', () => {
  it('reads in seconds under a minute', () => {
    assert.equal(formatGoalTime(0), '0s')
    assert.equal(formatGoalTime(9), '9s')
    assert.equal(formatGoalTime(59), '59s')
  })

  it('reads in minutes, then hours', () => {
    assert.equal(formatGoalTime(60), '1m')
    assert.equal(formatGoalTime(125), '2m 5s')
    assert.equal(formatGoalTime(3600), '1h')
    assert.equal(formatGoalTime(3720), '1h 2m')
  })
})

describe('goalStatusKey', () => {
  it('maps every kernel status to a label key', () => {
    assert.equal(goalStatusKey('active'), 'goalStatusActive')
    assert.equal(goalStatusKey('paused'), 'goalStatusPaused')
    assert.equal(goalStatusKey('budget-limited'), 'goalStatusBudgetLimited')
    assert.equal(goalStatusKey('complete'), 'goalStatusComplete')
    assert.equal(goalStatusKey('dropped'), 'goalStatusDropped')
  })
})

describe('goalActions', () => {
  // The kernel owns the state machine; offering a transition it would reject is
  // worse than offering none.
  it('offers the transitions that make sense per state', () => {
    assert.deepEqual(goalActions('active'), ['pause', 'complete', 'drop'])
    assert.deepEqual(goalActions('paused'), ['resume', 'drop'])
    assert.deepEqual(goalActions('budget-limited'), ['resume', 'drop'])
  })

  it('offers nothing for a goal that is already finished', () => {
    assert.deepEqual(goalActions('complete'), [])
    assert.deepEqual(goalActions('dropped'), [])
  })
})
