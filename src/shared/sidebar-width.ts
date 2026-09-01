/**
 * Bounds and resolution for the sidebar's user-adjustable width.
 *
 * Shared because the default is part of `AppSettings` (so main can seed
 * settings.json) while the clamping belongs to the renderer that drags the
 * handle — one definition keeps a hand-edited settings.json from producing a
 * sidebar that cannot be read or cannot be shrunk.
 */

/** Narrow enough to reclaim space, wide enough for the nav labels. */
export const MIN_SIDEBAR_WIDTH = 220
/** Wide enough for a long session title without crowding out the chat. */
export const MAX_SIDEBAR_WIDTH = 480
/**
 * Console rail: dense enough to feel like a workbench, not a card stack.
 */
export const DEFAULT_SIDEBAR_WIDTH = 256


/** Coerce any stored or dragged value into a usable whole-pixel width. */
export function clampSidebarWidth(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_SIDEBAR_WIDTH
  return Math.round(Math.min(Math.max(raw, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH))
}

/**
 * The width to render: an in-progress drag wins, then the saved setting, then the
 * default (the sidebar renders before the settings IPC round-trip resolves).
 */
export function resolveSidebarWidth(
  draft: number | null,
  persisted: number | null | undefined
): number {
  if (draft !== null) return clampSidebarWidth(draft)
  if (persisted !== null && persisted !== undefined) return clampSidebarWidth(persisted)
  return DEFAULT_SIDEBAR_WIDTH
}
