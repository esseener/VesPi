import type { AppSettings } from '../../shared/ipc-contracts'
import { interactionModeCommands } from '../../shared/interaction-modes'
import type { PiRpcManager } from '../pi-rpc-manager'

/**
 * Push the configured message-delivery modes at one live session.
 *
 * Fire-and-forget on purpose: the kernel treats these as session state (it
 * echoes them back in `get_state`) and does not reject an unknown value, so
 * there is nothing to await and no failure worth surfacing — the value sets in
 * shared/interaction-modes.ts exist to keep a bad one from being sent at all.
 *
 * Called right after a session starts — by then the manager is ready, which the
 * workspace manager already relies on when it issues its own `get_state` at the
 * same point — and again whenever the setting changes, so a running session
 * picks the new value up without a restart.
 */
export function applyInteractionModes(pi: PiRpcManager, settings: AppSettings): void {
  for (const command of interactionModeCommands(settings)) {
    pi.sendCommandFireAndForget(command)
  }
}

/** Same, for every live session — used when the setting itself changes. */
export function applyInteractionModesToAll(
  managers: Iterable<PiRpcManager>,
  settings: AppSettings
): void {
  for (const pi of managers) applyInteractionModes(pi, settings)
}
