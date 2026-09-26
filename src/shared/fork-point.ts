/** A prior user message that can be forked from (RPC `get_fork_messages`). */
export interface ForkPoint {
  entryId: string
  text: string
}

/**
 * Pull the message array out of whatever the main process forwarded.
 *
 * The IPC handler returns Pi's RPC response verbatim, so the renderer sees
 * `{data:{messages:[…]}}` (or `{messages:[…]}` on a bare payload) rather than
 * the array `getUserMessagesForBranching()` produced. Unwrapping here keeps the
 * handler consistent with every other one instead of special-casing this call.
 */
function unwrapMessages(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'object' || raw === null) return null
  const root = raw as Record<string, unknown>
  if (Array.isArray(root.messages)) return root.messages
  const data = root.data
  if (typeof data === 'object' && data !== null) {
    const inner = data as Record<string, unknown>
    if (Array.isArray(inner.messages)) return inner.messages
  }
  return null
}

/**
 * Normalize the RPC branch-list payload into ForkPoints. Both the wrapped
 * response and the bare array are accepted (see `unwrapMessages`), and the RPC
 * field names are tolerated (`entryId`|`id`, `text`|`content`) so a minor
 * Pi/OMP schema difference does not break the UI. Entries without an id are
 * dropped.
 */
export function normalizeForkMessages(raw: unknown): ForkPoint[] {
  const list = unwrapMessages(raw)
  if (list === null) return []
  const out: ForkPoint[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as Record<string, unknown>
    const id = rec.entryId ?? rec.id
    if (typeof id !== 'string' || id.length === 0) continue
    const text = rec.text ?? rec.content ?? ''
    out.push({ entryId: id, text: String(text) })
  }
  return out
}
