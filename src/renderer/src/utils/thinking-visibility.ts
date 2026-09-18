/**
 * Whether a live turn's thinking block opens expanded.
 *
 * False, deliberately. A stream that opens with a wall of reasoning buries the
 * answer the user is waiting for, and the very same turn then collapses the
 * moment it commits — which reads as the toggle doing the opposite of what it
 * says. Collapsed matches a committed turn's block: a "Thinking" header with a
 * chevron, a spinner while it runs, and the text only when asked for.
 *
 * Kept as a named decision so the choice is testable and has exactly one place
 * to flip if "stream live thinking open" ever becomes a preference.
 */
export function liveThinkingStartsExpanded(): boolean {
  return false
}
