/**
 * Shell-side view of the subagents the kernel spawns for `task` tool calls.
 *
 * The kernel reports them over RPC (`subagent_lifecycle` / `subagent_progress`)
 * but only after the client subscribes — the subscription level defaults to
 * `off`, which is why nothing about a running subagent ever reached the UI
 * before. Without this the user sees one `task` tool card that sits there for
 * minutes with no sign of what it is doing or how many helpers are in flight.
 *
 * Everything here is pure so the merge rules can be tested without a kernel:
 * the two event shapes differ in where they put the id, progress frames are
 * thin (they omit labels the lifecycle frame supplied), and terminal status
 * strings are the kernel's own vocabulary rather than a closed set.
 */

/** How a subagent is shown, collapsed from the kernel's own status strings. */
export type SubagentStatusKind = 'running' | 'finished' | 'failed'

export interface SubagentRun {
  id: string
  /** Kernel-assigned display order; absent on some frames. */
  index: number
  /**
   * The agent that runs it. Optional because a progress frame may omit the
   * label — substituting the id here would look like real data and then
   * overwrite the name a lifecycle frame had already supplied.
   */
  agent?: string
  description?: string
  task?: string
  status: string
  kind: SubagentStatusKind
  parentToolCallId?: string
}

/** Subscription levels the kernel accepts (`off` is its default). */
export const SUBAGENT_SUBSCRIPTION_LEVELS = ['off', 'progress', 'events'] as const
export type SubagentSubscriptionLevel = (typeof SUBAGENT_SUBSCRIPTION_LEVELS)[number]

/**
 * The level the shell subscribes at: `progress` carries lifecycle + step
 * updates, while `events` would relay every inner event of every subagent —
 * far more traffic than a status strip can use.
 */
export const SUBAGENT_SUBSCRIPTION: SubagentSubscriptionLevel = 'progress'

export function subagentSubscriptionCommand(
  level: SubagentSubscriptionLevel = SUBAGENT_SUBSCRIPTION
): Record<string, unknown> {
  return { type: 'set_subagent_subscription', level }
}

/**
 * Classify a kernel status. Terminal spellings vary (`completed`, `cancelled`,
 * `failed`, …) and the kernel may add more, so anything unrecognized counts as
 * finished rather than leaving a row spinning forever on screen.
 */
export function subagentStatusKind(status: string): SubagentStatusKind {
  const normalized = status.trim().toLowerCase()
  if (normalized === 'running' || normalized === 'started' || normalized === 'pending') {
    return 'running'
  }
  if (normalized === 'failed' || normalized === 'error') return 'failed'
  return 'finished'
}

interface SubagentLifecyclePayload {
  id?: unknown
  index?: unknown
  agent?: unknown
  description?: unknown
  status?: unknown
  task?: unknown
  parentToolCallId?: unknown
}

interface SubagentProgressPayload {
  index?: unknown
  agent?: unknown
  task?: unknown
  parentToolCallId?: unknown
  progress?: { id?: unknown; status?: unknown; description?: unknown }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asIndex(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Build a run from a lifecycle frame. Returns null when it carries no id. */
export function subagentRunFromLifecycle(payload: SubagentLifecyclePayload): SubagentRun | null {
  const id = asString(payload.id)
  if (!id) return null
  const status = asString(payload.status) ?? 'running'
  return {
    id,
    index: asIndex(payload.index),
    agent: asString(payload.agent),
    description: asString(payload.description),
    task: asString(payload.task),
    status,
    kind: subagentStatusKind(status),
    parentToolCallId: asString(payload.parentToolCallId),
  }
}

/** Build a run from a progress frame. The id lives under `progress`. */
export function subagentRunFromProgress(payload: SubagentProgressPayload): SubagentRun | null {
  const id = asString(payload.progress?.id)
  if (!id) return null
  const status = asString(payload.progress?.status) ?? 'running'
  return {
    id,
    index: asIndex(payload.index),
    agent: asString(payload.agent),
    description: asString(payload.progress?.description),
    task: asString(payload.task),
    status,
    kind: subagentStatusKind(status),
    parentToolCallId: asString(payload.parentToolCallId),
  }
}

function withoutUndefined(run: SubagentRun): Partial<SubagentRun> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(run)) {
    if (value !== undefined) out[key] = value
  }
  return out as Partial<SubagentRun>
}

/**
 * Merge one frame into the list.
 *
 * A progress frame is thin — it has no `agent` or `description` unless the
 * kernel happened to include them — so a later frame must never erase what an
 * earlier lifecycle frame established. Fields the incoming frame omits are
 * kept.
 */
export function upsertSubagentRun(runs: readonly SubagentRun[], incoming: SubagentRun): SubagentRun[] {
  const at = runs.findIndex((run) => run.id === incoming.id)
  if (at === -1) {
    return [...runs, incoming].sort((a, b) => a.index - b.index || a.id.localeCompare(b.id))
  }
  const next = runs.slice()
  next[at] = { ...next[at], ...withoutUndefined(incoming) }
  return next
}

export function runningSubagentCount(runs: readonly SubagentRun[]): number {
  return runs.reduce((total, run) => total + (run.kind === 'running' ? 1 : 0), 0)
}
