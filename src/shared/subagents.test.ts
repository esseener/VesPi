import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  runningSubagentCount,
  subagentRunFromLifecycle,
  subagentRunFromProgress,
  subagentStatusKind,
  subagentSubscriptionCommand,
  upsertSubagentRun,
  type SubagentRun,
} from './subagents'

test('classifies the kernel status vocabulary', () => {
  assert.equal(subagentStatusKind('running'), 'running')
  assert.equal(subagentStatusKind('started'), 'running')
  assert.equal(subagentStatusKind('completed'), 'finished')
  assert.equal(subagentStatusKind('cancelled'), 'finished')
  assert.equal(subagentStatusKind('failed'), 'failed')
  assert.equal(subagentStatusKind('error'), 'failed')
  // Unknown spellings settle instead of spinning on screen forever.
  assert.equal(subagentStatusKind('something-new'), 'finished')
})

test('builds a run from a lifecycle frame', () => {
  const run = subagentRunFromLifecycle({
    id: 'a1',
    index: 2,
    agent: 'explore',
    description: 'map the repo',
    status: 'running',
    parentToolCallId: 'call-1',
  })
  assert.deepEqual(run, {
    id: 'a1',
    index: 2,
    agent: 'explore',
    description: 'map the repo',
    task: undefined,
    status: 'running',
    kind: 'running',
    parentToolCallId: 'call-1',
  } satisfies SubagentRun)
})

test('drops frames without an id', () => {
  assert.equal(subagentRunFromLifecycle({ status: 'running' }), null)
  assert.equal(subagentRunFromProgress({ progress: { status: 'running' } }), null)
})

test('reads the id out of the progress sub-object', () => {
  const run = subagentRunFromProgress({
    index: 1,
    agent: 'general-purpose',
    progress: { id: 'b2', status: 'running', description: 'step 3' },
  })
  assert.equal(run?.id, 'b2')
  assert.equal(run?.description, 'step 3')
  assert.equal(run?.agent, 'general-purpose')
})

test('a thin progress frame does not erase the labels a lifecycle frame set', () => {
  const first = subagentRunFromLifecycle({
    id: 'a1',
    index: 0,
    agent: 'explore',
    description: 'map the repo',
    status: 'running',
  })!
  const after = upsertSubagentRun([first], subagentRunFromProgress({
    progress: { id: 'a1', status: 'running' },
  })!)
  assert.equal(after.length, 1)
  assert.equal(after[0].agent, 'explore')
  assert.equal(after[0].description, 'map the repo')
})

test('appends new runs in kernel order and updates existing ones', () => {
  const a = subagentRunFromLifecycle({ id: 'a', index: 1, status: 'running' })!
  const b = subagentRunFromLifecycle({ id: 'b', index: 0, status: 'running' })!
  const list = upsertSubagentRun(upsertSubagentRun([], a), b)
  assert.deepEqual(list.map((run) => run.id), ['b', 'a'])

  const done = subagentRunFromLifecycle({ id: 'a', index: 1, status: 'completed' })!
  const after = upsertSubagentRun(list, done)
  assert.equal(after.length, 2)
  assert.equal(after.find((run) => run.id === 'a')?.kind, 'finished')
  assert.equal(runningSubagentCount(after), 1)
})

test('subscription command uses the level the kernel accepts', () => {
  assert.deepEqual(subagentSubscriptionCommand(), {
    type: 'set_subagent_subscription',
    level: 'progress',
  })
  assert.deepEqual(subagentSubscriptionCommand('off'), {
    type: 'set_subagent_subscription',
    level: 'off',
  })
})
