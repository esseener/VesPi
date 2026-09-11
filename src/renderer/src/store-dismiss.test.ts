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
  updates: {
    check: async () => checkResult,
  },
}

/** What the next `updates.check()` returns. */
let checkResult: unknown = null

function offer(latest: string, kernelLatest = '18.1.9'): unknown {
  return {
    updateAvailable: true,
    latestVersion: latest,
    currentVersion: '1.0.15',
    kernel: { updateAvailable: false, latestVersion: kernelLatest, currentVersion: kernelLatest },
  }
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

// The window re-checks on a timer so a release published while the app stays
// open still surfaces. That only works if a dismissal survives re-checks of the
// SAME offer — otherwise every timer tick would re-open a banner the user just
// closed. A genuinely newer offer must still get through.
test('a re-check of the same offer does not re-open a dismissed banner', async () => {
  checkResult = offer('1.0.99')
  await useAppStore.getState().checkForUpdates()
  assert.equal(useAppStore.getState().updateDismissed, false, 'a fresh offer shows the banner')

  useAppStore.getState().dismissUpdate()
  assert.equal(useAppStore.getState().updateDismissed, true)

  await useAppStore.getState().checkForUpdates()
  assert.equal(useAppStore.getState().updateDismissed, true, 'the timer tick must not re-open it')
})

test('a newer offer re-arms a dismissed banner', async () => {
  checkResult = offer('1.0.99')
  await useAppStore.getState().checkForUpdates()
  useAppStore.getState().dismissUpdate()
  assert.equal(useAppStore.getState().updateDismissed, true)

  checkResult = offer('1.1.0')
  await useAppStore.getState().checkForUpdates()
  assert.equal(useAppStore.getState().updateDismissed, false, 'a newer release must surface again')
})

test('a check failure re-arms a dismissed banner', async () => {
  checkResult = offer('1.0.99')
  await useAppStore.getState().checkForUpdates()
  useAppStore.getState().dismissUpdate()

  checkResult = { ...(offer('1.0.99') as object), checkError: 'offline' }
  await useAppStore.getState().checkForUpdates()
  assert.equal(useAppStore.getState().updateDismissed, false, 'a new failure is news too')
})

test('no update at all keeps the banner hidden', async () => {
  checkResult = {
    updateAvailable: false,
    latestVersion: '1.0.15',
    currentVersion: '1.0.15',
    kernel: { updateAvailable: false, latestVersion: '18.1.9', currentVersion: '18.1.9' },
  }
  await useAppStore.getState().checkForUpdates()
  assert.equal(useAppStore.getState().updateDismissed, true)
})
