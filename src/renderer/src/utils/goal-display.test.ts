import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  formatGoalTime,
  formatTokenCount,
  goalActions,
  goalControlFailureKey,
  goalStatusKey,
  normalizeGoalState,
} from './goal-display'
import type { GoalModeState } from '../../../shared/ipc-contracts'

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
  // worse than offering none. The `goal` tool's op union is
  // `create | get | complete | resume | drop` (kernel 18.2.5) — there is no
  // `pause`, so a pause button could never work and must not be offered.
  it('offers the transitions that make sense per state', () => {
    assert.deepEqual(goalActions('active'), ['complete', 'drop'])
    assert.deepEqual(goalActions('paused'), ['resume', 'drop'])
    assert.deepEqual(goalActions('budget-limited'), ['resume', 'drop'])
  })

  it('offers nothing for a goal that is already finished', () => {
    assert.deepEqual(goalActions('complete'), [])
    assert.deepEqual(goalActions('dropped'), [])
  })
})

describe('normalizeGoalState', () => {
  const goal = (status: string) =>
    ({
      id: 'g1',
      objective: 'do the thing',
      status,
      tokensUsed: 10,
      timeUsedSeconds: 1,
      createdAt: 1,
      updatedAt: 2,
    }) as GoalModeState['goal']

  it('keeps live goals untouched', () => {
    for (const status of ['active', 'paused', 'budget-limited'] as const) {
      const state: GoalModeState = { enabled: true, mode: 'active', goal: goal(status) }
      assert.equal(normalizeGoalState(state), state)
    }
  })

  it('drops terminal goals: the kernel never sends a clearing event after drop/complete', () => {
    // The kernel's drop path emits `{ enabled: false, goal: { status: 'dropped' } }`
    // and then persists the cleared state WITHOUT emitting. Mirroring that last
    // event verbatim made the strip show a dead goal forever.
    for (const status of ['dropped', 'complete'] as const) {
      assert.equal(normalizeGoalState({ enabled: false, goal: goal(status) }), null)
      // Even if the kernel someday reports enabled: true for a finished goal,
      // a terminal goal offers no actions and is not live.
      assert.equal(normalizeGoalState({ enabled: true, goal: goal(status) }), null)
    }
  })

  it('normalizes missing state and missing goals to nothing', () => {
    assert.equal(normalizeGoalState(null), null)
    assert.equal(normalizeGoalState(undefined), null)
    assert.equal(normalizeGoalState({ enabled: true }), null)
    assert.equal(normalizeGoalState({ enabled: true, goal: undefined }), null)
  })
})

describe('goalControlFailureKey', () => {
  it('says the extension is missing when the command was never registered', () => {
    // Not retryable by clicking again: the same process keeps answering no.
    assert.equal(goalControlFailureKey('extension-missing'), 'goalControlFailedExtension')
  })

  it('blames the runtime when there is no live kernel to talk to', () => {
    assert.equal(goalControlFailureKey('pi-not-running'), 'goalControlFailedRuntime')
    assert.equal(goalControlFailureKey('no-pi'), 'goalControlFailedRuntime')
  })

  it('falls back to a retry hint for transport failures', () => {
    assert.equal(goalControlFailureKey('timeout'), 'goalControlFailedGeneric')
    assert.equal(goalControlFailureKey('dispatch-failed'), 'goalControlFailedGeneric')
    assert.equal(goalControlFailureKey(undefined), 'goalControlFailedGeneric')
  })
})
