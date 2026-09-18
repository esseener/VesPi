import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldFollowContent, shouldFollowStream } from './scroll-follow'

// The three reported cases, locked down. Each one was a real report: the follow
// either stopped when it should not have, or failed to resume when the user did
// something that plainly meant "show me the answer".

const base = { autoScroll: true, userDetached: false, grew: false, lastIsUser: false }

test('content that grows after the last scroll still follows', () => {
  // Report: "the output stopped coming out; I had to scroll a bit and then it
  // resumed". The viewport had been left above the new bottom by content that
  // grew without a scroll event — nobody scrolled away, so nothing may stop it.
  assert.equal(shouldFollowContent({ ...base, grew: true }), true)
})

test('a user who deliberately scrolled away is left where they are', () => {
  assert.equal(shouldFollowContent({ ...base, grew: true, userDetached: true }), false)
})

test('sending always reveals the bottom, even from a scrolled-up position', () => {
  // Report: "after an interruption, sending again did not scroll to the answer".
  // A send outranks a detached viewport: it is an explicit request to see what
  // happens next, and queued prompts count the same as fresh ones.
  assert.equal(shouldFollowContent({ ...base, grew: true, lastIsUser: true, userDetached: true }), true)
})

test('a new message that is not the user’s follows only when the viewport is with us', () => {
  assert.equal(shouldFollowContent({ ...base, grew: true, lastIsUser: false }), true)
  assert.equal(shouldFollowContent({ ...base, grew: true, lastIsUser: false, userDetached: true }), false)
})

test('Auto Scroll off keeps the view still', () => {
  assert.equal(shouldFollowContent({ ...base, autoScroll: false, grew: true, lastIsUser: true }), false)
  assert.equal(shouldFollowStream({ autoScroll: false, active: true, userDetached: false }), false)
})

test('streamed tokens follow the tail only while the reader is with it', () => {
  assert.equal(shouldFollowStream({ autoScroll: true, active: true, userDetached: false }), true)
  assert.equal(shouldFollowStream({ autoScroll: true, active: true, userDetached: true }), false)
  // A hidden panel has no layout, so it must not be scrolled behind the user's back.
  assert.equal(shouldFollowStream({ autoScroll: true, active: false, userDetached: false }), false)
})

test('reaching the bottom again re-arms following', () => {
  // The jump-to-bottom button and a manual scroll to the end both clear the
  // detached flag; this is what that buys.
  const detached = shouldFollowStream({ autoScroll: true, active: true, userDetached: true })
  const reattached = shouldFollowStream({ autoScroll: true, active: true, userDetached: false })
  assert.equal(detached, false)
  assert.equal(reattached, true)
})
