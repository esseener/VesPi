import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

/**
 * Goal mode for the agent.
 *
 * The kernel ships goal mode — a persistent objective the agent keeps working
 * toward, with its own state machine and token/time accounting — but it keeps the
 * `goal` tool in `HIDDEN_TOOLS` instead of the model's active tool set. Measured
 * 2026-09-14 on kernel 18.1.20: asked directly whether it had a goal tool, the
 * model answered `NONE`.
 *
 * So the shell's whole job here is to put that tool in front of the model:
 *
 *   setActiveTools([...active, 'goal'])
 *
 * Everything else stays kernel-owned — the objective, when it is considered
 * complete, the token budget, and the continuation between turns. The GUI mirrors
 * the kernel's `goal_updated` events (objective, status, tokens used) so the
 * objective is visible while it runs, rather than the agent quietly working on
 * something the user cannot see.
 *
 * Deliberately default-on: a capability the model does not know about is a
 * capability the product does not have.
 */
export default function vespiGoalMode(pi: ExtensionAPI): void {
  pi.on('session_start', async () => {
    try {
      const active = await pi.getActiveTools()
      const tools = Array.isArray(active) ? active : []
      const names = tools.map((tool) => (tool as { name?: string })?.name ?? String(tool))
      if (names.includes('goal')) return
      await pi.setActiveTools([...names, 'goal'])
    } catch (err) {
      // A future kernel may rename or drop this API. Fail soft: the session keeps
      // working, the model simply has no goal tool — which is the status quo.
      const logger = (pi as unknown as { logger?: { warn?: (message: string) => void } }).logger
      logger?.warn?.('vespi-goal: could not activate the goal tool: ' + String(err))
    }
  })
}
