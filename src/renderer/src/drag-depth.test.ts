import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DRAG_RESET, afterDragEnter, afterDragLeave, showsDropOverlay } from './drag-depth'

/** Cross `count` element boundaries inside the window: enter then leave each. */
function crossElements(count: number): number {
  let depth = DRAG_RESET
  for (let i = 0; i < count; i += 1) {
    depth = afterDragEnter(depth, true)
    depth = afterDragLeave(depth, false)
  }
  return depth
}

test('moving between children does not latch the overlay on', () => {
  // Each crossing pairs up, so the overlay follows the pointer rather than the
  // number of elements it passed over.
  assert.equal(showsDropOverlay(crossElements(1)), false)
  assert.equal(showsDropOverlay(crossElements(7)), false)

  // Mid-crossing: entered a child but not left it yet.
  const inside = afterDragEnter(DRAG_RESET, true)
  assert.equal(showsDropOverlay(inside), true)
})

test('a drop resets the count outright, however deep it had gone', () => {
  // The regression: the composer claims the drop and stops propagation, so
  // nothing decremented the count and the overlay stayed on screen until some
  // later drag happened to unwind it.
  let depth = DRAG_RESET
  for (let i = 0; i < 5; i += 1) depth = afterDragEnter(depth, true)
  assert.equal(showsDropOverlay(depth), true)

  depth = DRAG_RESET // what the capture-phase drop listener does
  assert.equal(showsDropOverlay(depth), false)
})

test('leaving the window resets, however unbalanced the count had become', () => {
  let depth = DRAG_RESET
  for (let i = 0; i < 4; i += 1) depth = afterDragEnter(depth, true)
  // One leave, but with the pointer now outside the window.
  depth = afterDragLeave(depth, true)
  assert.equal(depth, DRAG_RESET)
  assert.equal(showsDropOverlay(depth), false)
})

test('a plain leave only unwinds one level', () => {
  let depth = afterDragEnter(afterDragEnter(DRAG_RESET, true), true)
  assert.equal(depth, 2)
  depth = afterDragLeave(depth, false)
  assert.equal(depth, 1)
  assert.equal(showsDropOverlay(depth), true, 'still over the window')
})

test('a drag that is not an OS file drag never raises the overlay', () => {
  // Dragging in-app content (a session row, the logo) must not offer to open a
  // workspace — and its leaves must not push the count negative.
  assert.equal(afterDragEnter(DRAG_RESET, false), DRAG_RESET)
  assert.equal(showsDropOverlay(afterDragEnter(DRAG_RESET, false)), false)

  // Its leaves still arrive, so the count has to survive them unbalanced.
  assert.equal(afterDragLeave(DRAG_RESET, false), DRAG_RESET)
  assert.equal(afterDragLeave(afterDragLeave(DRAG_RESET, false), false), DRAG_RESET)
})

test('an unbalanced file drag cannot leave the overlay up forever', () => {
  // Enters without leaves (the shape of the stuck state), then the fix's exit.
  let depth = DRAG_RESET
  for (let i = 0; i < 3; i += 1) depth = afterDragEnter(depth, true)
  assert.equal(showsDropOverlay(depth), true)

  depth = afterDragLeave(depth, true)
  assert.equal(depth, DRAG_RESET)
  assert.equal(showsDropOverlay(depth), false)
  assert.equal(showsDropOverlay(afterDragEnter(depth, true)), true, 'and the next drag still works')
})
