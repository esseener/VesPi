/**
 * Depth counter for OS file drags over the window.
 *
 * Chromium fires `dragenter`/`dragleave` once per element the cursor crosses, so
 * a boolean would flicker as the pointer moves between children. Counting pairs
 * is the fix — but a counter only works while every entry has a matching exit,
 * and two exits have no `dragleave` at all:
 *
 *  - a **drop**, which is the drag ending where it was aimed, and
 *  - a drag that ends **off-window** or is cancelled with Esc.
 *
 * Both reset outright instead of decrementing. Decrementing them is what left
 * the overlay stuck over the app: the composer claims file drops and calls
 * `stopPropagation`, so the window's own drop handler never ran, and the counter
 * stayed above zero with nothing left to unwind it.
 *
 * `afterDragEnter` takes the drag kind because the overlay only ever appears for
 * OS file drags; a non-file drag then under-counts rather than over-counts,
 * which the clamp in `afterDragLeave` keeps harmless.
 */

/** The count an ended, dropped or departed drag settles back to. */
export const DRAG_RESET = 0

export function afterDragEnter(current: number, isFileDrag: boolean): number {
  return isFileDrag ? current + 1 : current
}

export function afterDragLeave(current: number, leftWindow: boolean): number {
  if (leftWindow) return DRAG_RESET
  return current > 0 ? current - 1 : DRAG_RESET
}

/** Whether the window-level drop hint should be on screen. */
export function showsDropOverlay(depth: number): boolean {
  return depth > 0
}
