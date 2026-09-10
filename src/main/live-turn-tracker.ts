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
 * Pure event bookkeeping: no I/O, injectable clock, unit-testable.
 */

interface LiveTurnState {
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
        // A new assistant message starts a fresh text buffer. Completed tool
        // calls from the previous message linger (mirroring the renderer),
        // so only the text buffers reset here.
        const role = (event as { message?: { role?: unknown } }).message?.role
        if (role === 'assistant') {
          const state = stateFor(manager)
          state.streamingContent = ''
          state.streamingThinking = ''
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
        // The message is committed and persisted; the renderer's buffers reset
        // here too, so a re-attach after this point reads it from get_messages.
        reset(stateFor(manager))
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
