/**
 * Whether the chat should move itself to the bottom.
 *
 * The rule these encode, learned the hard way over three separate reports:
 *
 *  - The trigger is what the USER did, not where the viewport happens to be.
 *    "Is the viewport at the bottom right now" can turn false without anyone
 *    scrolling — content that grows after the last follow (a late-loading image,
 *    a reflowing block, a notice appended behind the prompt) leaves the viewport
 *    above the new bottom — and a follower keyed on that measurement sat out the
 *    rest of the turn ("I had to scroll down before new output showed up").
 *    `userDetached` is only ever set by a real scroll event, so it cannot be
 *    falsified that way.
 *
 *  - Sending is always a "show me what happens next". A queued prompt, a session
 *    that is still writing — both mean the tail, regardless of where the reader
 *    had parked.
 *
 *  - Auto Scroll off means the view never moves on its own.
 */

export interface ContentFollowInput {
  /** Settings → Auto Scroll. */
  autoScroll: boolean
  /** The user scrolled away from the bottom and has not come back. */
  userDetached: boolean
  /** The message list grew since the last pass. */
  grew: boolean
  /** The newest message is the user's own — they just sent it. */
  lastIsUser: boolean
}

export function shouldFollowContent(input: ContentFollowInput): boolean {
  if (!input.autoScroll) return false
  if (input.lastIsUser) return true
  return input.grew && !input.userDetached
}

export interface StreamFollowInput {
  /** Settings → Auto Scroll. */
  autoScroll: boolean
  /** The chat panel is on screen; a hidden panel has no layout to scroll. */
  active: boolean
  /** The user scrolled away from the bottom and has not come back. */
  userDetached: boolean
}

export function shouldFollowStream(input: StreamFollowInput): boolean {
  return input.active && input.autoScroll && !input.userDetached
}
