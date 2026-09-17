import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAgentBrowserLifecycle, isBrowserToolName, type AgentBrowserLifecycleDeps } from './agent-browser-lifecycle'

function harness(overrides: Partial<AgentBrowserLifecycleDeps> = {}) {
  const calls: string[] = []
  const deps: AgentBrowserLifecycleDeps = {
    enabled: true,
    port: 9223,
    isUp: async () => {
      calls.push('isUp')
      return false
    },
    start: async () => {
      calls.push('start')
      return 'launched'
    },
    withdraw: () => calls.push('withdraw'),
    log: () => {},
    ...overrides,
  }
  return { calls, deps }
}

test('startup never launches a browser', async () => {
  const { calls, deps } = harness()
  await createAgentBrowserLifecycle(deps).sync('startup')

  assert.deepEqual(calls, ['isUp', 'withdraw'], 'a dead endpoint is withdrawn, not launched into')
})

test('a browser left running from a previous run is adopted at startup', async () => {
  const { calls, deps } = harness({
    isUp: async () => true,
    start: async () => {
      calls.push('start')
      return 'reused'
    },
  })
  await createAgentBrowserLifecycle(deps).sync('startup')

  assert.deepEqual(calls, ['start'], 'no window appears for a browser that is already up')
})

test('the agent reaching for a browser is what starts one', async () => {
  const { calls, deps } = harness()
  await createAgentBrowserLifecycle(deps).ensure('browser-tool')

  assert.deepEqual(calls, ['start'], 'the launch is on the tool call, not on startup')
})

test('an unavailable browser withdraws the endpoint instead of pointing at nothing', async () => {
  const { calls, deps } = harness({
    start: async () => {
      calls.push('start')
      return 'unavailable'
    },
  })
  await createAgentBrowserLifecycle(deps).ensure('browser-tool')

  assert.deepEqual(calls, ['start', 'withdraw'], 'a configured-but-dead endpoint fails the kernel call; an absent one does not')
})

test('a burst of tool calls starts at most one browser', async () => {
  let started = 0
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const { deps } = harness({
    start: async () => {
      started += 1
      await gate
      return 'launched'
    },
  })
  const lifecycle = createAgentBrowserLifecycle(deps)

  const first = lifecycle.ensure('browser-tool')
  const second = lifecycle.ensure('browser-tool')
  const third = lifecycle.ensure('browser-tool')
  release()
  await Promise.all([first, second, third])

  assert.equal(started, 1)
})

test('the setting being off leaves the kernel alone entirely', async () => {
  const { calls, deps } = harness({ enabled: false, port: null })
  const lifecycle = createAgentBrowserLifecycle(deps)

  await lifecycle.sync('startup')
  await lifecycle.ensure('browser-tool')

  assert.deepEqual(calls, ['withdraw'], 'off means no endpoint and no launch, but stale wiring still gets cleaned up')
})

test('browser tool names are recognised across both tool sets', () => {
  assert.equal(isBrowserToolName('browser'), true)
  assert.equal(isBrowserToolName('browser_navigate'), true)
  assert.equal(isBrowserToolName('browser_snapshot'), true)
  assert.equal(isBrowserToolName('mcp__playwright__browser_click'), true)

  assert.equal(isBrowserToolName('bash'), false)
  assert.equal(isBrowserToolName('web_search'), false)
  assert.equal(isBrowserToolName('read'), false)
  assert.equal(isBrowserToolName(''), false)
})
