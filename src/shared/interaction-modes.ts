/**
 * The kernel's three message-delivery modes — how a message sent while the
 * agent is working actually reaches it.
 *
 * The kernel accepts `set_steering_mode` / `set_follow_up_mode` /
 * `set_interrupt_mode` over RPC and echoes the live values back in `get_state`,
 * but VesPi only carried two of the three as unused type fields: no UI existed
 * and nothing ever sent the commands, so every session silently ran the kernel
 * defaults and the user had no way to reach them.
 *
 * The value sets are the kernel's own (its settings schema, tab `interaction`,
 * group `Input`). The kernel does NOT validate them — an unknown value is
 * stored as-is and later compared against these literals, so a typo would
 * quietly behave as neither option instead of erroring. Keeping one list here,
 * read by both the menu and the outgoing command, is what prevents that.
 */

/** How queued messages are processed while the agent is working. */
export const STEERING_MODES = ['one-at-a-time', 'all'] as const
export type SteeringMode = (typeof STEERING_MODES)[number]

/** How follow-up messages are drained once a turn completes. */
export const FOLLOW_UP_MODES = ['one-at-a-time', 'all'] as const
export type FollowUpMode = (typeof FOLLOW_UP_MODES)[number]

/** Whether a steering message may interrupt tool execution. */
export const INTERRUPT_MODES = ['immediate', 'wait'] as const
export type InterruptMode = (typeof INTERRUPT_MODES)[number]

export interface InteractionModeSettings {
  steeringMode: SteeringMode
  followUpMode: FollowUpMode
  interruptMode: InterruptMode
}

/** The kernel's own defaults, so a session that was never pushed to matches. */
export const DEFAULT_INTERACTION_MODES: InteractionModeSettings = {
  steeringMode: 'one-at-a-time',
  followUpMode: 'one-at-a-time',
  interruptMode: 'immediate',
}

/**
 * The RPC commands that bring a session onto `settings`. Parameter name is
 * `mode` for all three (verified against the running kernel).
 */
export function interactionModeCommands(
  settings: InteractionModeSettings
): Array<Record<string, unknown>> {
  return [
    { type: 'set_steering_mode', mode: settings.steeringMode },
    { type: 'set_follow_up_mode', mode: settings.followUpMode },
    { type: 'set_interrupt_mode', mode: settings.interruptMode },
  ]
}
