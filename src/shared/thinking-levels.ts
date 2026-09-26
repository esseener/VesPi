/**
 * What a model can actually do with thinking — and what the kernel will do with
 * a level it cannot use.
 *
 * The kernel keeps a per-model capability table (models.dev-shaped) and hands it
 * to the shell through `ModelInfo.thinking.efforts`, so the shell never has to
 * guess. It only has to stop guessing: the level menu used to fall back to all
 * seven levels whenever a model declared none, which offered choices that do
 * nothing on that model and said nothing about it afterwards.
 *
 * Three states, and they are not the same thing:
 *
 *  - `reasoning: false` — the kernel refuses thinking outright (`Model … does
 *    not support thinking`);
 *  - `reasoning: true` with no declared efforts — the kernel knows the model
 *    thinks but not which levels it accepts, so it can honour none of them;
 *  - a declared list — the only case where a level is a real choice.
 *
 * The coercion mirrors the kernel's (`resolveLevel` in its catalog): a level the
 * model does not declare is rounded DOWN to the highest level it does, and
 * anything below the model's lowest collapses to that lowest. Showing the user
 * the requested level when the kernel is about to use a different one is the
 * kind of quiet lie this module exists to prevent.
 */

/** Canonical order. The kernel's own comparison order, low to high. */
export const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number] | 'off'

/** The subset of a model this module needs. */
export interface ThinkingCapability {
  reasoning?: boolean
  thinking?: { mode?: string; efforts?: string[] }
}

export type ThinkingSupport =
  | { kind: 'unsupported' }
  | { kind: 'undeclared' }
  | { kind: 'levels'; levels: ThinkingLevel[] }

/**
 * What to offer for this model. `off` is always available — every provider can
 * be asked for no reasoning — so the list is never empty when levels exist.
 */
export function thinkingSupport(model: ThinkingCapability | null | undefined): ThinkingSupport {
  if (!model?.reasoning) return { kind: 'unsupported' }
  const declared = model.thinking?.efforts?.filter((level): level is ThinkingLevel =>
    (THINKING_LEVELS as readonly string[]).includes(level)
  )
  if (!declared || declared.length === 0) return { kind: 'undeclared' }
  return {
    kind: 'levels',
    levels: ['off', ...THINKING_LEVELS.filter((level) => declared.includes(level))],
  }
}

/**
 * The level the kernel will actually use for `requested` on this model — its
 * `resolveLevel`, reimplemented. Returns null when thinking is unavailable, and
 * `requested` unchanged when the model declares nothing to round within.
 */
export function effectiveThinkingLevel(
  model: ThinkingCapability | null | undefined,
  requested: string
): ThinkingLevel | null {
  if (!model?.reasoning) return null
  const support = thinkingSupport(model)
  if (support.kind !== 'levels') return null
  if (support.levels.includes(requested as ThinkingLevel)) return requested as ThinkingLevel

  const wanted = THINKING_LEVELS.indexOf(requested as (typeof THINKING_LEVELS)[number])
  if (wanted === -1) return null

  let best: ThinkingLevel | null = null
  for (const level of THINKING_LEVELS) {
    if (THINKING_LEVELS.indexOf(level) > wanted) break
    if (support.levels.includes(level)) best = level
  }
  // Below everything the model accepts, the kernel collapses onto its lowest.
  return best ?? support.levels[1] ?? null
}
