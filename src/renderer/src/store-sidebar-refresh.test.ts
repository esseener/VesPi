import { test, before } from 'node:test'
import assert from 'node:assert/strict'

// Regression: the sidebar row for a brand-new session used to depend solely on
// the agent_start refresh, which races OMP flushing the first message to disk
// (a header-only file is filtered as empty). When the race lost, nothing ever
// re-listed, so the row stayed missing even after the turn completed. agent_end
// must schedule a list refresh as the backstop.
const piDesktopStub = {
  pi: {
    getStatus: async () => ({ status: 'stopped' as const, pid: null, error: null }),
  },
}

type AppStore = typeof import('./store')['useAppStore']
let useAppStore: AppStore

before(async () => {
  ;(globalThis as unknown as { window: unknown }).window = { piDesktop: piDesktopStub }
  ;({ useAppStore } = await import('./store'))
})

test('agent_end schedules a session list refresh', async () => {
  let refreshes = 0
  const original = useAppStore.getState().refreshSessionList
  useAppStore.setState({
    refreshSessionList: async () => {
      refreshes++
    },
  })
  try {
    useAppStore.getState().handlePiEvent({ type: 'agent_end' } as never)
    // scheduleSessionListRefresh debounces by 250ms.
    await new Promise((resolve) => setTimeout(resolve, 400))
    assert.ok(refreshes >= 1, 'agent_end must refresh the session list so the row appears even when the agent_start refresh raced the file write')
  } finally {
    useAppStore.setState({ refreshSessionList: original })
  }
})
