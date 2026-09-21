import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { ActivityStatsStore } from './activity-stats'
import { setPiExecutableOverride } from './pi-rpc-manager'

// Fixed reference instant so window math is deterministic.
const NOW = new Date('2026-07-05T12:00:00')

function isoOn(day: string, hour = 12): string {
  return new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).toISOString()
}

interface MsgOpts {
  role?: 'user' | 'assistant'
  model?: string
  input?: number
  output?: number
  hour?: number
}

function messageLine(day: string, opts: MsgOpts = {}): string {
  const { role = 'user', model, input = 0, output = 0, hour = 12 } = opts
  const message: Record<string, unknown> = { role }
  if (role === 'assistant' && model) {
    message.model = model
    message.usage = { input, output }
  }
  return JSON.stringify({ type: 'message', timestamp: isoOn(day, hour), message })
}

async function makeDirs(): Promise<{ root: string; storePath: string }> {
  const base = await mkdtemp(join(tmpdir(), 'stats-'))
  const root = join(base, 'sessions')
  await mkdir(root, { recursive: true })
  return { root, storePath: join(base, 'activity-stats.json') }
}

test('aggregates messages, tokens, models and sessions across files', async () => {
  const { root, storePath } = await makeDirs()
  await mkdir(join(root, 'ws'), { recursive: true })
  await writeFile(
    join(root, 'ws/s1.jsonl'),
    [
      messageLine('2026-07-04', { role: 'user' }),
      messageLine('2026-07-04', { role: 'assistant', model: 'claude-opus-4-8', input: 100, output: 900 }),
    ].join('\n')
  )
  await writeFile(
    join(root, 'ws/s2.jsonl'),
    messageLine('2026-07-05', { role: 'assistant', model: 'claude-sonnet-5', input: 10, output: 40 })
  )

  const store = new ActivityStatsStore({ sessionsRoot: root, storePath })
  const result = await store.computeStats(NOW)
  const year = result.ranges['365']

  assert.equal(year.messages, 3)
  assert.equal(year.sessions, 2)
  assert.equal(year.totalTokens, 100 + 900 + 10 + 40)
  assert.equal(year.activeDays, 2)
  // Models sorted desc by total; Opus (1000) before Sonnet (50).
  assert.equal(year.models[0].model, 'claude-opus-4-8')
  assert.equal(year.models[0].output, 900)
  assert.equal(year.models[1].model, 'claude-sonnet-5')

  await rm(root, { recursive: true, force: true })
})

test('preserves a session after its file is deleted (captureBeforeDelete)', async () => {
  const { root, storePath } = await makeDirs()
  const file = join(root, 's1.jsonl')
  await writeFile(file, messageLine('2026-07-04', { role: 'assistant', model: 'claude-opus-4-8', input: 5, output: 5 }))

  const store = new ActivityStatsStore({ sessionsRoot: root, storePath })

  // Capture before delete, with no prior scan, then remove the file.
  store.captureBeforeDelete(file)
  await rm(file)

  const result = await store.computeStats(NOW)
  assert.equal(result.ranges['365'].messages, 1)
  assert.equal(result.ranges['365'].totalTokens, 10)
  assert.equal(result.ranges['365'].sessions, 1)

  await rm(root, { recursive: true, force: true })
})

test('persists across store instances (survives process restart)', async () => {
  const { root, storePath } = await makeDirs()
  const file = join(root, 's1.jsonl')
  await writeFile(file, messageLine('2026-07-03', { role: 'user' }))

  const first = new ActivityStatsStore({ sessionsRoot: root, storePath })
  first.flushSync(NOW) // synchronous scan + write to disk

  // New instance, and the source file is now gone.
  await rm(file)
  const second = new ActivityStatsStore({ sessionsRoot: root, storePath })
  const result = await second.computeStats(NOW)
  assert.equal(result.ranges['365'].messages, 1)

  await rm(root, { recursive: true, force: true })
})

test('re-parses a file when its content changes', async () => {
  const { root, storePath } = await makeDirs()
  const file = join(root, 's1.jsonl')
  await writeFile(file, messageLine('2026-07-04', { role: 'user' }))

  const store = new ActivityStatsStore({ sessionsRoot: root, storePath })
  let result = await store.computeStats(NOW)
  assert.equal(result.ranges['365'].messages, 1)

  await writeFile(
    file,
    [messageLine('2026-07-04', { role: 'user' }), messageLine('2026-07-04', { role: 'user' })].join('\n')
  )
  // Bump mtime so the change is detected even if the rewrite lands in the same
  // filesystem mtime tick (the store re-parses on mtime change).
  const future = new Date(Date.now() + 2000)
  await utimes(file, future, future)
  result = await store.computeStats(NOW)
  assert.equal(result.ranges['365'].messages, 2)

  await rm(root, { recursive: true, force: true })
})

test('range filter: 7d excludes older activity that 1Y includes', async () => {
  const { root, storePath } = await makeDirs()
  await writeFile(join(root, 's1.jsonl'), messageLine('2026-07-04', { role: 'user' })) // in 7d
  await writeFile(join(root, 's2.jsonl'), messageLine('2026-05-01', { role: 'user' })) // outside 7d, inside 1Y

  const store = new ActivityStatsStore({ sessionsRoot: root, storePath })
  const result = await store.computeStats(NOW)

  assert.equal(result.ranges['365'].messages, 2)
  assert.equal(result.ranges['7'].messages, 1)

  await rm(root, { recursive: true, force: true })
})

test('computes current and longest streaks', async () => {
  const { root, storePath } = await makeDirs()
  // Active Jul 3,4,5 (3-day streak ending today) and an isolated day earlier.
  await writeFile(
    join(root, 's1.jsonl'),
    [
      messageLine('2026-07-03', { role: 'user' }),
      messageLine('2026-07-04', { role: 'user' }),
      messageLine('2026-07-05', { role: 'user' }),
      messageLine('2026-06-20', { role: 'user' }),
    ].join('\n')
  )

  const store = new ActivityStatsStore({ sessionsRoot: root, storePath })
  const year = (await store.computeStats(NOW)).ranges['365']
  assert.equal(year.currentStreak, 3)
  assert.equal(year.longestStreak, 3)

  await rm(root, { recursive: true, force: true })
})

test('peak hour reflects the busiest local hour', async () => {
  const { root, storePath } = await makeDirs()
  await writeFile(
    join(root, 's1.jsonl'),
    [
      messageLine('2026-07-04', { role: 'user', hour: 9 }),
      messageLine('2026-07-04', { role: 'user', hour: 23 }),
      messageLine('2026-07-04', { role: 'user', hour: 23 }),
    ].join('\n')
  )

  const store = new ActivityStatsStore({ sessionsRoot: root, storePath })
  const year = (await store.computeStats(NOW)).ranges['365']
  assert.equal(year.peakHour, 23)

  await rm(root, { recursive: true, force: true })
})

test('resolves model names from models.json, keyed by id', async () => {
  const { root, storePath } = await makeDirs()
  const modelsConfigPath = join(root, '..', 'models.json')
  await writeFile(
    modelsConfigPath,
    JSON.stringify({
      providers: {
        lmstudio: { models: [{ id: 'ornith-1.0-35b@q6_k', name: 'Ornith 1.0 Q6' }] },
      },
    })
  )
  await writeFile(
    join(root, 's1.jsonl'),
    [
      messageLine('2026-07-04', { role: 'assistant', model: 'ornith-1.0-35b@q6_k', input: 10, output: 20 }),
      messageLine('2026-07-04', { role: 'assistant', model: 'no-such-model', input: 1, output: 1 }),
    ].join('\n')
  )

  const store = new ActivityStatsStore({ sessionsRoot: root, storePath, modelsConfigPath })
  const models = (await store.computeStats(NOW)).ranges['365'].models
  const ornith = models.find((m) => m.model === 'ornith-1.0-35b@q6_k')
  const unknown = models.find((m) => m.model === 'no-such-model')
  assert.equal(ornith?.name, 'Ornith 1.0 Q6')
  assert.equal(unknown?.name, null) // not in models.json → null (frontend falls back to id)

  await rm(root, { recursive: true, force: true })
})

test('keeps last-known name after a model is removed from models.json', async () => {
  const { root, storePath } = await makeDirs()
  const modelsConfigPath = join(root, '..', 'models.json')
  await writeFile(join(root, 's1.jsonl'), messageLine('2026-07-04', { role: 'assistant', model: 'm1', input: 5, output: 5 }))

  // First scan with the name present.
  await writeFile(modelsConfigPath, JSON.stringify({ providers: { p: { models: [{ id: 'm1', name: 'Model One' }] } } }))
  const first = new ActivityStatsStore({ sessionsRoot: root, storePath, modelsConfigPath })
  first.flushSync(NOW)

  // The model disappears from models.json; a fresh instance should still show it.
  await rm(modelsConfigPath)
  const second = new ActivityStatsStore({ sessionsRoot: root, storePath, modelsConfigPath })
  const models = (await second.computeStats(NOW)).ranges['365'].models
  assert.equal(models.find((m) => m.model === 'm1')?.name, 'Model One')

  await rm(root, { recursive: true, force: true })
})

test('prunes sessions older than the retention window', async () => {
  const { root, storePath } = await makeDirs()
  await writeFile(join(root, 'old.jsonl'), messageLine('2024-01-01', { role: 'user' }))

  const store = new ActivityStatsStore({ sessionsRoot: root, storePath })
  const result = await store.computeStats(NOW)
  assert.equal(result.ranges['365'].messages, 0)

  await rm(root, { recursive: true, force: true })
})

/**
 * VesPi runs only the OMP engine, so its sessions live in the OMP store — but
 * the dashboard used to scan just one root. Everything it showed was therefore
 * whatever had been captured at delete time, frozen: live usage was invisible.
 * These two pin the fix.
 */
async function withSessionStores<T>(
  run: (dirs: { piAgent: string; ompAgent: string; ompSessions: string; storePath: string }) => Promise<T>
): Promise<T> {
  const base = await mkdtemp(join(tmpdir(), 'stats-roots-'))
  const previousPi = process.env.PI_CODING_AGENT_DIR
  const previousOmp = process.env.OMP_CODING_AGENT_DIR
  const piAgent = join(base, 'pi-agent')
  const ompAgent = join(base, 'omp-agent')
  process.env.PI_CODING_AGENT_DIR = piAgent
  process.env.OMP_CODING_AGENT_DIR = ompAgent
  // The store picks its root from the engine, so pin it rather than depend on
  // whatever this machine happens to have installed. VesPi only ever runs OMP.
  setPiExecutableOverride(undefined, 'omp')
  const ompSessions = join(ompAgent, 'sessions')
  await mkdir(ompSessions, { recursive: true })
  try {
    return await run({ piAgent, ompAgent, ompSessions, storePath: join(base, 'activity-stats.json') })
  } finally {
    setPiExecutableOverride(undefined, 'auto')
    if (previousPi === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = previousPi
    if (previousOmp === undefined) delete process.env.OMP_CODING_AGENT_DIR
    else process.env.OMP_CODING_AGENT_DIR = previousOmp
    await rm(base, { recursive: true, force: true })
  }
}

test('scans the OMP session store, which is the only one VesPi writes', async () => {
  await withSessionStores(async ({ ompSessions, storePath }) => {
    await mkdir(join(ompSessions, '--D--proj--'), { recursive: true })
    await writeFile(
      join(ompSessions, '--D--proj--', '2026-07-05T00-00-00-000Z_abc.jsonl'),
      messageLine('2026-07-05', { role: 'assistant', model: 'deepseek-v4.1-flash', input: 700, output: 300 })
    )

    // No sessionsRoot override: this is the production wiring, which resolves
    // the roots from the engine exactly as the app does.
    const store = new ActivityStatsStore({ storePath })
    const year = (await store.computeStats(NOW)).ranges['365']

    assert.equal(year.sessions, 1)
    assert.equal(year.totalTokens, 1000)
    assert.equal(year.models[0].model, 'deepseek-v4.1-flash')
  })
})

test('subagent transcripts of the same role in two projects stay separate', async () => {
  await withSessionStores(async ({ ompSessions, storePath }) => {
    for (const project of ['--D--alpha--', '--D--beta--']) {
      const dir = join(ompSessions, project, 'session-1')
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'FixVerifier.jsonl'),
        messageLine('2026-07-05', { role: 'assistant', model: 'grok-4.6', input: 100, output: 0 })
      )
    }

    const store = new ActivityStatsStore({ storePath })
    const year = (await store.computeStats(NOW)).ranges['365']

    // Keyed by bare name these would collapse into one entry and lose half the
    // tokens; keyed by their path below the root they stay two.
    assert.equal(year.sessions, 2)
    assert.equal(year.totalTokens, 200)
  })
})
