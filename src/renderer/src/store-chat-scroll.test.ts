import { test, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Sending has to pull the chat back to the bottom. The chat once stayed parked
// above a running answer (a queued steer never moved the view, and the follower
// had given up because content had grown after its last scroll), so the user had
// to scroll down by hand before new output showed up — these lock in the "tell
// the chat to scroll" half of that fix.
const calls: string[] = []
const piDesktopStub = {
  pi: {
    getStatus: async () => ({ status: 'stopped' as const, pid: null, error: null }),
  },
  commands: {
    prompt: async (message: string) => {
      calls.push(`prompt:${message}`)
    },
    steer: async (message: string) => {
      calls.push(`steer:${message}`)
    },
    followUp: async (message: string) => {
      calls.push(`followUp:${message}`)
    },
  },
}

type AppStore = typeof import('./store')['useAppStore']
let useAppStore: AppStore

before(async () => {
  ;(globalThis as unknown as { window: unknown }).window = { piDesktop: piDesktopStub }
  ;({ useAppStore } = await import('./store'))
})

beforeEach(() => {
  calls.length = 0
  useAppStore.setState({
    messages: [],
    chatScrollBottomNonce: 0,
    isStreaming: false,
    piStatus: 'running',
  })
})

test('a queued steer renders the prompt and asks the chat to scroll', async () => {
  const before = useAppStore.getState().chatScrollBottomNonce

  await useAppStore.getState().sendSteer('hello')

  const state = useAppStore.getState()
  assert.equal(state.chatScrollBottomNonce, before + 1, 'the chat is asked to scroll')
  assert.equal(state.messages.at(-1)?.role, 'user', 'the queued prompt is visible at once')
  assert.deepEqual(calls, ['steer:hello'])
})

test('a queued follow-up renders the prompt and asks the chat to scroll', async () => {
  const before = useAppStore.getState().chatScrollBottomNonce

  await useAppStore.getState().sendFollowUp('next step')

  const state = useAppStore.getState()
  assert.equal(state.chatScrollBottomNonce, before + 1, 'the chat is asked to scroll')
  assert.equal(state.messages.at(-1)?.role, 'user')
  assert.deepEqual(calls, ['followUp:next step'])
})

test('a fresh prompt asks the chat to scroll as well', async () => {
  const before = useAppStore.getState().chatScrollBottomNonce

  await useAppStore.getState().sendPrompt('hi')

  const state = useAppStore.getState()
  assert.equal(state.chatScrollBottomNonce, before + 1, 'the chat is asked to scroll')
  assert.equal(state.messages.at(-1)?.role, 'user')
})
