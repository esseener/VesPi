import type { PiRpcManager } from './pi-rpc-manager'
import type {
  LiveTurnSnapshot,
  LiveTurnToolCall,
  PiMessageUpdateEvent,
  PiRpcEvent,
  PiToolExecutionEndEvent,
  PiToolExecutionStartEvent,
  PiToolExecutionUpdateEvent,
} from '../shared/ipc-contracts'

/**
 * Tracks each session runtime's CURRENT in-progress assistant turn, so a
 * session re-attached mid-turn (workspace/session switch) can immediately show
 * what is actually streaming instead of waiting for the next event.
 *
 * The kernel's `get_messages` only returns committed messages; the in-progress
 * assistant message and executing tool calls live in the kernel's stream state
 * and are not exposed over RPC. This tracker mirrors the renderer's stream
 * buffer mutations from every manager's events (the router already receives
 * them for ALL managers, it just only forwards the active one's), keeping a
 * faithful snapshot per runtime. The renderer restores it on re-attach and
 * keeps appending from the events that follow.
 *
 * SCOPE: one whole turn (agent_start → agent_end), not one assistant message.
 * A turn interleaves several assistant messages (text, then a tool call, then
 * more text); the renderer commits each on `message_end` and clears its own
 * buffers, but those commits never reach `get_messages` until the turn ends.
 * Resetting here on `message_end` therefore left a re-attaching renderer with
 * only the tail of the turn — the earlier text and every completed tool call
 * vanished until the model produced its next event. Completed tool calls and
 * text are accumulated for the turn's duration so the restored view matches
 * what the user would have seen had they never switched away.
 *
 * Pure event bookkeeping: no I/O, injectable clock, unit-testable.
 */

interface LiveTurnState {
  /** Text accumulated across every assistant message in the current turn. */
  streamingContent: string
  streamingThinking: string
  streamingToolCalls: Map<string, LiveTurnToolCall>
}

function emptyTurn(): LiveTurnState {
  return {
    streamingContent: '',
    streamingThinking: '',
    streamingToolCalls: new Map(),
  }
}

/**
 * Start a new assistant message's text section within the same turn. Returns
 * the accumulated text with a blank line appended, so the restored snapshot
 * reads as separated paragraphs rather than one run-on block.
 */
function joinTurnText(accumulated: string): string {
  if (accumulated === '') return ''
  return accumulated.endsWith('\n\n') ? accumulated : `${accumulated}\n\n`
}

export interface LiveTurnTracker {
  /** Wire a manager's streaming events into the tracker. Idempotent. */
  attachManager(manager: PiRpcManager): void
  /** Current in-progress turn snapshot for a manager, or null when idle. */
  snapshotFor(manager: PiRpcManager): LiveTurnSnapshot | null
}

export function createLiveTurnTracker(deps: { now(): number } = { now: () => Date.now() }): LiveTurnTracker {
  const states = new Map<PiRpcManager, LiveTurnState>()
  const attached = new WeakSet<PiRpcManager>()

  const stateFor = (manager: PiRpcManager): LiveTurnState => {
    let state = states.get(manager)
    if (!state) {
      state = emptyTurn()
      states.set(manager, state)
    }
    return state
  }

  const reset = (state: LiveTurnState): void => {
    state.streamingContent = ''
    state.streamingThinking = ''
    state.streamingToolCalls.clear()
  }

  const handleEvent = (manager: PiRpcManager, event: PiRpcEvent): void => {
    switch (event.type) {
      case 'agent_start':
      case 'agent_end':
        // A fresh turn starts empty; a finished one has nothing live left.
        reset(stateFor(manager))
        break

      case 'message_start': {
        // A new assistant message appends to the turn's accumulated text. Both
        // text buffers are separated by a blank line so consecutive messages
        // read the way the committed bubbles do, instead of running together.
        const role = (event as { message?: { role?: unknown } }).message?.role
        if (role === 'assistant') {
          const state = stateFor(manager)
          state.streamingContent = joinTurnText(state.streamingContent)
          state.streamingThinking = joinTurnText(state.streamingThinking)
        }
        break
      }

      case 'message_update': {
        const update = event as PiMessageUpdateEvent
        const state = stateFor(manager)
        const delta = update.assistantMessageEvent.delta ?? ''
        switch (update.assistantMessageEvent.type) {
          case 'text_delta':
            state.streamingContent += delta
            break
          case 'thinking_delta':
            state.streamingThinking += delta
            break
          case 'toolcall_start': {
            const call = update.assistantMessageEvent.toolCall as
              | { id?: unknown; name?: unknown }
              | undefined
            if (call && typeof call.id === 'string') {
              state.streamingToolCalls.set(call.id, {
                id: call.id,
                name: String(call.name ?? 'unknown'),
                args: '',
                isExecuting: true,
                startedAt: deps.now(),
              })
            }
            break
          }
          case 'toolcall_delta': {
            const call = update.assistantMessageEvent.toolCall as { id?: unknown } | undefined
            if (call && typeof call.id === 'string') {
              const existing = state.streamingToolCalls.get(call.id)
              if (existing) existing.args += delta
            }
            break
          }
          case 'toolcall_end': {
            const call = update.assistantMessageEvent.toolCall as
              | { id?: unknown; arguments?: unknown }
              | undefined
            if (call && typeof call.id === 'string') {
              const existing = state.streamingToolCalls.get(call.id)
              if (existing) {
                existing.isExecuting = false
                existing.args = JSON.stringify(call.arguments ?? existing.args)
              }
            }
            break
          }
        }
        break
      }

      case 'message_end':
        // Deliberately does NOT reset. The message is committed to the
        // kernel's transcript, but `get_messages` does not surface it until the
        // whole turn ends — so a re-attach right now would lose both this text
        // and every tool call before it. Keep accumulating until agent_end.
        break

      case 'tool_execution_start': {
        const tool = event as PiToolExecutionStartEvent
        stateFor(manager).streamingToolCalls.set(tool.toolCallId, {
          id: tool.toolCallId,
          name: tool.toolName,
          args: JSON.stringify(tool.args),
          isExecuting: true,
          startedAt: deps.now(),
        })
        break
      }

      case 'tool_execution_update': {
        const tool = event as PiToolExecutionUpdateEvent
        const text = tool.partialResult.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('')
        const existing = stateFor(manager).streamingToolCalls.get(tool.toolCallId)
        if (existing) existing.result = text || existing.result
        break
      }

      case 'tool_execution_end': {
        const tool = event as PiToolExecutionEndEvent
        const text = tool.result.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('')
        const existing = stateFor(manager).streamingToolCalls.get(tool.toolCallId)
        if (existing) {
          existing.isExecuting = false
          existing.isError = tool.isError
          existing.result = text || existing.result
          existing.durationMs = existing.startedAt ? deps.now() - existing.startedAt : existing.durationMs
        }
        break
      }
    }
  }

  const attachManager = (manager: PiRpcManager): void => {
    if (attached.has(manager)) return
    attached.add(manager)
    manager.on('event', (event: PiRpcEvent) => handleEvent(manager, event))
    manager.on('exit', () => states.delete(manager))
  }

  const snapshotFor = (manager: PiRpcManager): LiveTurnSnapshot | null => {
    const state = states.get(manager)
    if (!state) return null
    return {
      streamingContent: state.streamingContent,
      streamingThinking: state.streamingThinking,
      streamingToolCalls: Array.from(state.streamingToolCalls.values()),
    }
  }

  return { attachManager, snapshotFor }
}
