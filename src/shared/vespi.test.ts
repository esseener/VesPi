import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  isGoalControlOp,
  VESPI_GOAL_CONTROL_COMMAND,
  VESPI_GOAL_CONTROL_OPS,
  type GoalControlResult,
} from './vespi'

describe('goal control ops', () => {
  it('accepts exactly the three strip buttons', () => {
    for (const op of VESPI_GOAL_CONTROL_OPS) {
      assert.equal(isGoalControlOp(op), true, `${op} must be accepted`)
    }
  })

  it('rejects everything else, including a pause the kernel cannot perform', () => {
    // The goal tool's op union has no pause (kernel 18.2.5); a value that slipped
    // through here would be forwarded to the extension as a no-op.
    for (const value of ['pause', 'DROP', 'drop ', '', ' ', null, undefined, 1, {}, ['drop']]) {
      assert.equal(isGoalControlOp(value), false, `${String(value)} must be rejected`)
    }
  })

  it('names the extension command the shell dispatches', () => {
    // resources/vespi-goal.ts registers this name literally; the two must agree or
    // every click degrades into a real LLM prompt turn.
    assert.equal(VESPI_GOAL_CONTROL_COMMAND, 'vespi-goal')
  })

  it('reports failures as data so the strip can explain them', () => {
    const failure: GoalControlResult = { op: 'drop', ok: false, reason: 'extension-missing' }
    assert.equal(failure.ok, false)
    assert.equal(failure.reason, 'extension-missing')
  })
})
