import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readBrowserPanelState, writeBrowserPanelState, type BrowserPanelStorage } from './browser-panel-state'

function memoryStorage(initial?: string): BrowserPanelStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem() { return this.value },
    setItem(_key, value) { this.value = value },
  }
}

test('browser pages and open panels survive a renderer restart', () => {
  const storage = memoryStorage()
  const state = {
    workspace: { url: 'https://example.com/', open: true, nonce: 3 },
    blank: { url: null, open: true, nonce: 0 },
  }

  writeBrowserPanelState(state, storage)

  assert.deepEqual(readBrowserPanelState(storage), state)
})

test('invalid and non-web URLs are ignored when restoring state', () => {
  const storage = memoryStorage(JSON.stringify({
    good: { url: 'http://localhost:3000/', open: false, nonce: 1 },
    script: { url: 'javascript:alert(1)', open: true, nonce: 1 },
    malformed: { url: 'not a url', open: true, nonce: 1 },
    badShape: { url: 'https://example.com', open: 'yes', nonce: 1 },
  }))

  assert.deepEqual(readBrowserPanelState(storage), {
    good: { url: 'http://localhost:3000/', open: false, nonce: 1 },
  })
})

test('corrupt or unavailable browser state storage degrades to an empty state', () => {
  assert.deepEqual(readBrowserPanelState(memoryStorage('{')), {})
  assert.deepEqual(readBrowserPanelState({
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') },
  }), {})
  assert.doesNotThrow(() => writeBrowserPanelState({}, {
    getItem() { return null },
    setItem() { throw new Error('quota') },
  }))
})
