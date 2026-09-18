import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

  registerGoalControl(pi)
}

// ─── Goal strip → kernel ─────────────────────────────────────────────────────
//
// The goal strip's buttons used to push a "please call the goal tool" line into
// the chat as a user message. That was wrong twice over: mid-turn it queued
// behind a continuation turn that never yields (measured 2026-09-18: the click
// did nothing for as long as the objective kept running), and when it did land
// the user saw a mechanical instruction sitting in their own conversation.
//
// The kernel exposes no RPC, extension API or context method that reaches the
// goal state machine — verified against kernel 18.2.5 on 2026-09-18: the RPC
// command table has no goal entry, the ExtensionAPI's method list has none, and
// `ctx.invokeTool` is `undefined` for command contexts because `createContext()`
// is called without the tool-call argument that gates it. The `goal` tool
// (model-invoked) is the only way in.
//
// So the shell dispatches an extension command instead — the same mechanism its
// `/workflows` buttons already use. Commands run immediately even while a turn
// streams, and start no LLM turn of their own. This handler then steers a hidden
// message at the model: `display: false` keeps it out of the conversation, and
// `deliverAs: 'steer'` splices it into the running turn so the model sees it on
// its very next step instead of after the objective finally yields.

/** Must match `GOAL_CONTROL_COMMAND` in src/shared/vespi.ts — the shell hardcodes it. */
const GOAL_CONTROL_COMMAND = 'vespi-goal'
const GOAL_CONTROL_MESSAGE_TYPE = 'vespi-goal-control'

type GoalControlOp = 'resume' | 'complete' | 'drop'

const GOAL_CONTROL_OPS: readonly GoalControlOp[] = ['resume', 'complete', 'drop']

/** What each button means, phrased as the model must act on it. */
const OP_INSTRUCTION: Record<GoalControlOp, string> = {
  resume:
    'The user pressed "Resume" on the goal strip. Call the goal tool now with op="resume", then keep working toward the objective.',
  complete:
    'The user pressed "Complete" on the goal strip. Call the goal tool now with op="complete", then summarize what was finished in one or two lines.',
  drop: 'The user pressed "Drop" on the goal strip. Call the goal tool now with op="drop" and stop working on the objective. Do not do any more work on it, not even to tidy up.',
}

interface GoalCommandContext {
  /** False while a turn is streaming — then the message must be steered, not queued. */
  isIdle?: () => boolean
}

interface GoalControlHost {
  registerCommand?: (
    name: string,
    definition: {
      description: string
      handler: (args: string, context: GoalCommandContext) => Promise<string>
    }
  ) => void
  sendMessage?: (
    message: Record<string, unknown>,
    options?: Record<string, unknown>
  ) => Promise<unknown>
}

function registerGoalControl(pi: ExtensionAPI): void {
  const host = pi as unknown as GoalControlHost
  // Both are real kernel APIs (registerCommand / sendMessage appear in the
  // ExtensionAPI method table); bail out quietly if a future kernel drops them.
  if (typeof host.registerCommand !== 'function' || typeof host.sendMessage !== 'function') return
  const sendMessage = host.sendMessage

  host.registerCommand(GOAL_CONTROL_COMMAND, {
    description: `Drive the kernel goal from the VesPi goal strip: /${GOAL_CONTROL_COMMAND} <resume|complete|drop>.`,
    async handler(args, context) {
      const op = String(args ?? '').trim().split(/\s+/, 1)[0] ?? ''
      if (!(GOAL_CONTROL_OPS as readonly string[]).includes(op)) {
        return `usage: /${GOAL_CONTROL_COMMAND} <resume|complete|drop>`
      }

      let idle = false
      try {
        idle = typeof context?.isIdle === 'function' ? context.isIdle() : false
      } catch {
        // A throwing probe must not take the command down; treat it as streaming.
      }

      try {
        await sendMessage(
          {
            customType: GOAL_CONTROL_MESSAGE_TYPE,
            content: `[VESPI-GOAL-CONTROL] op=${op}\n${OP_INSTRUCTION[op as GoalControlOp]}`,
            display: false,
            attribution: 'user',
          },
          // Mid-turn: steer, so the instruction lands on the model's next step.
          // Idle (a budget-limited goal sits here): open a turn with it, or the
          // message waits for a turn that never comes.
          idle ? { deliverAs: 'nextTurn', triggerTurn: true } : { deliverAs: 'steer' }
        )
      } catch (err) {
        // Measured: the delivery bridge is wired up in the interactive and RPC
        // modes but not in `-p`, where `sendMessage` throws on an uninitialised
        // runtime. Report it as text instead of letting the command fail — the
        // strip then shows "the model has not reacted" rather than a dead button.
        // The file is diagnostics only: the RPC caller never sees command output.
        const detail = `goal ${op} could not be delivered: ${String(err)}`
        try {
          appendFileSync(join(tmpdir(), 'vespi-goal-control.log'), `${new Date().toISOString()} ${detail}\n`)
        } catch {
          // Diagnostics only — never let logging break the command.
        }
        return detail
      }

      return `goal ${op} requested`
    },
  })
}
