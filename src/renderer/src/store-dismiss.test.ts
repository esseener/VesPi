import { test, before } from 'node:test'
import assert from 'node:assert/strict'

// dismissUpdate must clear every source that can show the top banner: the
// available-update flag, the transient install-progress objects, and the
// failed-check fields. A previous fix only set updateDismissed, so the X did
// nothing on a "已安装 OMP 内核" banner.
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

test('dismissUpdate clears all three banner sources', () => {
  useAppStore.setState({
    updateDismissed: false,
    kernelUpdateProgress: { phase: 'done', percent: 100, receivedBytes: 0, totalBytes: 0, version: '18.1.9' },
    uiUpdateProgress: { phase: 'done', percent: 100, receivedBytes: 0, totalBytes: 0, version: '1.0.99' },
    updateInfo: {
      updateAvailable: true,
      latestVersion: '1.0.99',
      currentVersion: '1.0.15',
      checkError: 'offline',
      kernel: { updateAvailable: false, latestVersion: '18.1.9', currentVersion: '18.1.9', checkError: 'offline' },
    } as never,
  })

  useAppStore.getState().dismissUpdate()

  const s = useAppStore.getState()
  assert.equal(s.updateDismissed, true)
  assert.equal(s.kernelUpdateProgress, null)
  assert.equal(s.uiUpdateProgress, null)
  assert.equal(s.updateInfo?.checkError, undefined)
  assert.equal(s.updateInfo?.kernel.checkError, undefined)
})

test('dismissUpdate tolerates a missing updateInfo', () => {
  useAppStore.setState({ updateInfo: null, updateDismissed: false })
  useAppStore.getState().dismissUpdate()
  assert.equal(useAppStore.getState().updateDismissed, true)
  assert.equal(useAppStore.getState().updateInfo, null)
})
