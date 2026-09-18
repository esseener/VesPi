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

/**
 * Whether the floating composer should be out of the way.
 *
 * The composer overlays the transcript and is transparent by design, so while
 * the reader is scrolling back through history its text sits on top of the
 * messages they are trying to read. Hiding it resolves that overlap; returning
 * to the bottom brings it back with the caret.
 *
 * Both halves are required:
 *
 *  - `detached`: only hide when the view is away from the bottom. At the bottom
 *    the composer covers nothing the reader has not already seen, and it must
 *    be there to type into — hiding it on every keystroke-less moment would make
 *    the primary input flicker.
 *
 *  - `hasUserWork`: never hide something the user would lose. A draft, staged
 *    attachments, an open mention/slash menu or the mid-turn chooser all mean
 *    the composer is mid-interaction; its anchor disappearing would be worse
 *    than the overlap. A blocking extension prompt must stay answerable.
 *
 * Note the asymmetry in what "has user work" is NOT: focus alone does not count.
 * Clicking an empty composer and then scrolling back through history is exactly
 * the case this feature exists for, and the caret is restored on return.
 */
export interface ComposerVisibilityInput {
  /** The view is scrolled away from the bottom. */
  detached: boolean
  /** The composer holds a draft, attachments, an open menu, or a blocking prompt. */
  hasUserWork: boolean
}

export function shouldHideComposer(input: ComposerVisibilityInput): boolean {
  return input.detached && !input.hasUserWork
}
