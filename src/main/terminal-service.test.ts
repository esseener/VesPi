import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IPty } from 'node-pty'
import { TerminalService } from './terminal-service'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function harness() {
  const calls: { file: string; args: string[]; options: Record<string, unknown> }[] = []
  const terminals: { killed: boolean; writes: string[]; exit: () => void; disposed: number }[] = []
  const module = {
    spawn(file: string, args: string[], options: Record<string, unknown>) {
      const state = { killed: false, writes: [] as string[], exit: () => {}, disposed: 0 }
      terminals.push(state)
      calls.push({ file, args, options })
      return {
        pid: terminals.length,
        kill: () => { state.killed = true },
        write: (data: string) => { state.writes.push(data) },
        resize: () => {},
        onData: () => ({ dispose: () => { state.disposed++ } }),
        onExit: (listener: (event: { exitCode: number }) => void) => {
          state.exit = () => listener({ exitCode: 0 })
          return { dispose: () => { state.disposed++ } }
        },
      } as unknown as IPty
    },
  } as unknown as typeof import('node-pty')
  return { module, calls, terminals }
}

test('stop during asynchronous startup never spawns an orphan terminal', async () => {
  const h = harness()
  const loaded = Promise.withResolvers<typeof h.module>()
  const service = new TerminalService(() => loaded.promise)
  const start = service.start({}, () => {}, () => {})
  service.stop()
  loaded.resolve(h.module)
  await assert.rejects(start, /cancelled/)
  assert.equal(h.calls.length, 0)
  assert.equal(await service.restart(), null)
})

test('only the newest overlapping start may acquire the terminal', async () => {
  const h = harness()
  const loaded = Promise.withResolvers<typeof h.module>()
  const service = new TerminalService(() => loaded.promise)
  const old = service.start({ cols: 80 }, () => {}, () => {})
  const latest = service.start({ cols: 120 }, () => {}, () => {})
  loaded.resolve(h.module)
  await assert.rejects(old, /cancelled/)
  await latest
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].options.cols, 120)
  service.stop()
})

test('restart restores through OMP arguments and retains the latest terminal dimensions', async () => {
  const h = harness()
  const service = new TerminalService(async () => h.module, () => true)
  await service.start({ cols: 80, rows: 24 }, () => {}, () => {})
  service.resize(132, 40)
  const session = 'D:\\work space\\sessions\\conversation.jsonl'
  await service.restart({ resumeSessionPath: session })
  assert.deepEqual(h.calls[1].args, ['--profile', 'vespi', '--resume', session])
  assert.equal(h.calls[1].options.cols, 132)
  assert.equal(h.calls[1].options.rows, 40)
  assert.equal(h.terminals[0].killed, true)
  assert.equal(h.terminals[0].disposed, 2)
  assert.deepEqual(h.terminals[1].writes, [])
  service.stop()
})

test('late exit callbacks cannot clear a newer process or broadcast a stale exit', async () => {
  const h = harness()
  const service = new TerminalService(async () => h.module)
  let exits = 0
  await service.start({}, () => {}, () => { exits++ })
  await service.restart()
  h.terminals[0].exit()
  service.write('still running')
  assert.equal(exits, 0)
  assert.deepEqual(h.terminals[1].writes, ['still running'])
  h.terminals[1].exit()
  assert.equal(exits, 1)
  assert.equal(h.terminals[1].disposed, 2)
  service.stop()
})

test('invalid terminal dimensions never reach the native process', async () => {
  const h = harness()
  const service = new TerminalService(async () => h.module)
  await service.start({ cols: Infinity, rows: -1 }, () => {}, () => {})
  assert.equal(h.calls[0].options.cols, 80)
  assert.equal(h.calls[0].options.rows, 24)
  service.resize(NaN, 1.5)
  service.stop()
})

test('model restart selects the requested model while continuing the directory session', async () => {
  const h = harness()
  const service = new TerminalService(async () => h.module, () => true)
  await service.start({}, () => {}, () => {})
  await service.restart({ continueSession: true, model: 'provider/model' })
  assert.deepEqual(h.calls[1].args, ['--profile', 'vespi', '--continue', '--model', 'provider/model'])
  await service.restart({ continueSession: true, resumeSessionPath: 'known.jsonl', model: 'provider/other' })
  assert.deepEqual(h.calls[2].args, ['--profile', 'vespi', '--resume', 'known.jsonl', '--model', 'provider/other'])
  service.stop()
})

test('restarting after the known session was deleted opens a fresh terminal', async () => {
  const h = harness()
  const service = new TerminalService(async () => h.module, () => false)
  await service.start({}, () => {}, () => {})
  await service.restart({ resumeSessionPath: 'deleted.jsonl', continueSession: true, model: 'provider/model' })
  assert.deepEqual(h.calls[1].args, ['--profile', 'vespi', '--model', 'provider/model'])
  service.stop()
})

test('settings restart retains the selected model and native launch context', async () => {
  const h = harness()
  const service = new TerminalService(async () => h.module)
  await service.start({}, () => {}, () => {}, undefined, {
    model: 'provider/selected', args: ['--append-system-prompt', 'context.md'], env: { VESPI_TEST: 'context' },
  })
  await service.restart({ continueSession: true })
  assert.deepEqual(h.calls[1].args, ['--profile', 'vespi', '--continue', '--model', 'provider/selected', '--append-system-prompt', 'context.md'])
  assert.equal((h.calls[1].options.env as Record<string, string>).VESPI_TEST, 'context')
  service.stop()
})

test('session state belongs only to the live TUI PID and expires on stop', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vespi-tui-state-'))
  const file = join(dir, 'state.json')
  const h = harness()
  const service = new TerminalService(async () => h.module)
  try {
    await service.start({}, () => {}, () => {}, undefined, { env: { VESPI_TUI_STATE_FILE: file } })
    writeFileSync(file, JSON.stringify({ pid: 999, sessionPath: 'other.jsonl' }))
    assert.equal(service.getSessionState(), null)
    writeFileSync(file, JSON.stringify({ pid: 1, sessionPath: 'current.jsonl', model: 'a/b', busy: true, completed: 2, thinkingLevel: 'high' }))
    assert.deepEqual(service.getSessionState(), { sessionPath: 'current.jsonl', model: 'a/b', busy: true, completed: 2, thinkingLevel: 'high' })
    service.stop()
    assert.equal(service.getSessionState(), null)
  } finally { service.stop(); rmSync(dir, { recursive: true, force: true }) }
})
