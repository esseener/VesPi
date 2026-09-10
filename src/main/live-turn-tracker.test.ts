import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PiRpcManager } from './pi-rpc-manager'
import { createLiveTurnTracker, type LiveTurnTracker } from './live-turn-tracker'
import type { PiRpcEvent } from '../shared/ipc-contracts'

// Real PiRpcManager instances used as bare emitters — no child process is
// ever spawned. Events are emitted straight into the tracker.
function createHarness(): { tracker: LiveTurnTracker; manager: PiRpcManager; clock: { now: number } } {
  const clock = { now: 1000 }
  const tracker = createLiveTurnTracker({ now: () => clock.now })
  const manager = new PiRpcManager()
  tracker.attachManager(manager)
  return { tracker, manager, clock }
}

function emit(manager: PiRpcManager, event: PiRpcEvent): void {
  manager.emit('event', event)
}

function textDelta(delta: string): PiRpcEvent {
  return { type: 'message_update', message: {}, assistantMessageEvent: { type: 'text_delta', delta } } as PiRpcEvent
}

function thinkingDelta(delta: string): PiRpcEvent {
  return { type: 'message_update', message: {}, assistantMessageEvent: { type: 'thinking_delta', delta } } as PiRpcEvent
}

function toolcallStart(id: string, name: string): PiRpcEvent {
  return {
    type: 'message_update',
    message: {},
    assistantMessageEvent: { type: 'toolcall_start', toolCall: { id, name } },
  } as PiRpcEvent
}

function toolcallDelta(id: string, delta: string): PiRpcEvent {
  return {
    type: 'message_update',
    message: {},
    assistantMessageEvent: { type: 'toolcall_delta', toolCall: { id }, delta },
  } as PiRpcEvent
}

function toolcallEnd(id: string, args: Record<string, unknown>): PiRpcEvent {
  return {
    type: 'message_update',
    message: {},
    assistantMessageEvent: { type: 'toolcall_end', toolCall: { id, arguments: args } },
  } as PiRpcEvent
}

function assistantMessageStart(): PiRpcEvent {
  return { type: 'message_start', message: { role: 'assistant' } } as PiRpcEvent
}

function messageEnd(): PiRpcEvent {
  return { type: 'message_end', message: { role: 'assistant' } } as PiRpcEvent
}

function toolExecutionStart(id: string, name: string, args: Record<string, unknown> = {}): PiRpcEvent {
  return { type: 'tool_execution_start', toolCallId: id, toolName: name, args } as PiRpcEvent
}

function toolExecutionUpdate(id: string, text: string): PiRpcEvent {
  return {
    type: 'tool_execution_update',
    toolCallId: id,
    toolName: 'bash',
    args: {},
    partialResult: { content: [{ type: 'text', text }], details: {} },
  } as PiRpcEvent
}

function toolExecutionEnd(id: string, text: string): PiRpcEvent {
  return {
    type: 'tool_execution_end',
    toolCallId: id,
    toolName: 'bash',
    result: { content: [{ type: 'text', text }], details: {} },
    isError: false,
  } as PiRpcEvent
}

test('idle manager reports no snapshot', () => {
  const { tracker, manager } = createHarness()
  assert.equal(tracker.snapshotFor(manager), null)
})

test('accumulates streamed text and thinking across deltas', () => {
  const { tracker, manager } = createHarness()
  emit(manager, assistantMessageStart())
  emit(manager, textDelta('Hel'))
  emit(manager, textDelta('lo '))
  emit(manager, thinkingDelta('deep '))
  emit(manager, thinkingDelta('thought'))

  const snap = tracker.snapshotFor(manager)
  assert.equal(snap?.streamingContent, 'Hello ')
  assert.equal(snap?.streamingThinking, 'deep thought')
})

test('tracks tool calls through the assistant-message phases', () => {
  const { tracker, manager, clock } = createHarness()
  emit(manager, assistantMessageStart())
  emit(manager, textDelta('calling a tool'))
  emit(manager, toolcallStart('tc-1', 'bash'))
  emit(manager, toolcallDelta('tc-1', '{"cmd":'))
  emit(manager, toolcallDelta('tc-1', '"ls"}'))
  emit(manager, toolcallEnd('tc-1', { cmd: 'ls' }))

  const snap = tracker.snapshotFor(manager)
  assert.equal(snap?.streamingContent, 'calling a tool')
  assert.equal(snap?.streamingToolCalls.length, 1)
  const call = snap!.streamingToolCalls[0]
  assert.equal(call.id, 'tc-1')
  assert.equal(call.name, 'bash')
  assert.equal(call.isExecuting, false)
  assert.equal(call.args, '{"cmd":"ls"}')
  assert.equal(call.startedAt, clock.now)
})

test('tracks the executing tool after the assistant message commits', () => {
  const { tracker, manager, clock } = createHarness()
  emit(manager, assistantMessageStart())
  emit(manager, toolcallStart('tc-1', 'bash'))
  emit(manager, toolcallEnd('tc-1', { cmd: 'build' }))
  emit(manager, messageEnd())
  // Tool executes after its message committed; the buffer holds it live.
  emit(manager, toolExecutionStart('tc-1', 'bash', { cmd: 'build' }))
  emit(manager, toolExecutionUpdate('tc-1', 'step 1 of 10'))
  clock.now = 3000
  emit(manager, toolExecutionEnd('tc-1', 'done'))

  const snap = tracker.snapshotFor(manager)
  assert.equal(snap?.streamingContent, '')
  assert.equal(snap?.streamingToolCalls.length, 1)
  const call = snap!.streamingToolCalls[0]
  assert.equal(call.isExecuting, false)
  assert.equal(call.result, 'done')
  assert.equal(call.durationMs, 2000)
})

test('message_end and agent_end clear the buffer for the next turn', () => {
  const { tracker, manager } = createHarness()
  emit(manager, assistantMessageStart())
  emit(manager, textDelta('committed text'))
  emit(manager, messageEnd())

  assert.equal(tracker.snapshotFor(manager)?.streamingContent, '')

  emit(manager, assistantMessageStart())
  emit(manager, textDelta('second turn'))
  assert.equal(tracker.snapshotFor(manager)?.streamingContent, 'second turn')

  emit(manager, { type: 'agent_end' } as PiRpcEvent)
  assert.equal(tracker.snapshotFor(manager)?.streamingContent, '')
})

test('a fresh assistant message resets text but keeps completed tool calls', () => {
  const { tracker, manager } = createHarness()
  emit(manager, assistantMessageStart())
  emit(manager, toolcallStart('tc-1', 'bash'))
  emit(manager, toolcallEnd('tc-1', { cmd: 'build' }))
  emit(manager, messageEnd())
  emit(manager, toolExecutionStart('tc-1', 'bash', { cmd: 'build' }))
  emit(manager, toolExecutionEnd('tc-1', 'built'))
  // Next assistant message streams new text on top of the lingering tool card.
  emit(manager, assistantMessageStart())
  emit(manager, textDelta('next reply'))

  const snap = tracker.snapshotFor(manager)
  assert.equal(snap?.streamingContent, 'next reply')
  assert.equal(snap?.streamingToolCalls.length, 1)
  assert.equal(snap!.streamingToolCalls[0].isExecuting, false)
})

test('managers are tracked independently', () => {
  const tracker = createLiveTurnTracker({ now: () => 1000 })
  const a = new PiRpcManager()
  const b = new PiRpcManager()
  tracker.attachManager(a)
  tracker.attachManager(b)

  emit(a, assistantMessageStart())
  emit(a, textDelta('from A'))
  emit(b, assistantMessageStart())
  emit(b, textDelta('from B'))

  assert.equal(tracker.snapshotFor(a)?.streamingContent, 'from A')
  assert.equal(tracker.snapshotFor(b)?.streamingContent, 'from B')
})

test('attachManager is idempotent', () => {
  const tracker = createLiveTurnTracker({ now: () => 1000 })
  const manager = new PiRpcManager()
  tracker.attachManager(manager)
  tracker.attachManager(manager)

  emit(manager, assistantMessageStart())
  emit(manager, textDelta('once'))
  assert.equal(tracker.snapshotFor(manager)?.streamingContent, 'once')
})
