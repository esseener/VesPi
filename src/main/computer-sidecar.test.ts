import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, it } from 'node:test'
import type { spawn } from 'node:child_process'

import { createComputerSidecar } from './computer-sidecar'

/**
 * The sidecar client is where a hung agent would come from: a request with no
 * answer, or an answer nobody is waiting for, parks a model call forever. These
 * tests cover the framing, the timeout and the death of the helper, with a fake
 * child process so nothing is actually launched.
 */

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  written: string[] = []
  exitCode: number | null = null
  killed = false

  stdin = {
    write: (chunk: string, callback?: (error?: Error | null) => void): boolean => {
      this.written.push(chunk)
      callback?.(null)
      return true
    },
  }

  respond(payload: unknown): void {
    this.stdout.write(`${JSON.stringify(payload)}\n`)
  }

  writeRaw(text: string): void {
    this.stdout.write(text)
  }

  exit(code = 0): void {
    this.exitCode = code
    this.emit('exit', code)
  }

  kill(): void {
    this.killed = true
    this.exitCode = 1
    this.emit('exit', 1)
  }

  /** The last request the client wrote, parsed. */
  lastRequest(): { id: number; method: string; params: Record<string, unknown> } {
    const line = this.written[this.written.length - 1] ?? ''
    return JSON.parse(line.trim()) as { id: number; method: string; params: Record<string, unknown> }
  }
}

function setup(defaultTimeoutMs = 50) {
  const children: FakeChild[] = []
  const spawnProcess = (() => {
    const child = new FakeChild()
    children.push(child)
    return child
  }) as unknown as typeof spawn
  const logs: string[] = []

  const sidecar = createComputerSidecar({
    exePath: 'C:\\fake\\vespi-cua.exe',
    log: (message) => logs.push(message),
    spawnProcess,
    defaultTimeoutMs,
  })

  return {
    sidecar,
    children,
    logs,
    last: (): FakeChild => {
      const child = children[children.length - 1]
      if (!child) throw new Error('no child process was spawned')
      return child
    },
  }
}

describe('computer sidecar: lifecycle', () => {
  it('does not start a helper until something asks for one', () => {
    const { sidecar, children } = setup()
    assert.equal(children.length, 0)
    assert.equal(sidecar.isRunning(), false)
  })

  it('starts exactly one helper for several calls', async () => {
    const { sidecar, children, last } = setup()
    const first = sidecar.call('ping')
    last().respond({ id: 1, ok: true, result: { pong: true } })
    await first
    const second = sidecar.call('ping')
    last().respond({ id: 2, ok: true, result: { pong: true } })
    await second
    assert.equal(children.length, 1)
  })

  it('fails the calls in flight when the helper dies, then starts a fresh one', async () => {
    const { sidecar, children, last } = setup()
    const first = sidecar.call('ping')
    last().respond({ id: 1, ok: true, result: {} })
    await first

    // A call in flight when the helper dies has to be told, not left hanging.
    const doomed = sidecar.call('ping')
    last().exit(1)
    await assert.rejects(() => doomed, /exited/)

    // The next call spawns a replacement rather than reusing the corpse.
    const retry = sidecar.call('ping')
    const child = last()
    assert.equal(children.length, 2)
    child.respond({ id: child.lastRequest().id, ok: true, result: {} })
    await retry
  })

  it('kills the helper and fails nothing on dispose', async () => {
    const { sidecar, last } = setup()
    const pending = sidecar.call('ping')
    sidecar.dispose()
    await assert.rejects(() => pending, /turned off/)
    assert.equal(last().killed, true)
    assert.equal(sidecar.isRunning(), false)
  })
})

describe('computer sidecar: requests and responses', () => {
  it('sends a JSON line with a method and params', async () => {
    const { sidecar, last } = setup()
    const promise = sidecar.call('list_windows', { max: 5 })
    const request = last().lastRequest()
    assert.equal(request.method, 'list_windows')
    assert.deepEqual(request.params, { max: 5 })
    last().respond({ id: request.id, ok: true, result: { windows: [] } })
    assert.deepEqual(await promise, { windows: [] })
  })

  it('matches responses to requests by id, in any order', async () => {
    const { sidecar, last } = setup()
    const first = sidecar.call('screen_info')
    const second = sidecar.call('list_windows')
    const child = last()

    child.respond({ id: 2, ok: true, result: { windows: ['second'] } })
    child.respond({ id: 1, ok: true, result: { screen: 'first' } })

    assert.deepEqual(await second, { windows: ['second'] })
    assert.deepEqual(await first, { screen: 'first' })
  })

  it('turns an error response into a rejection carrying the reason', async () => {
    const { sidecar, last } = setup()
    const promise = sidecar.call('capture')
    last().respond({ id: 1, ok: false, error: 'the capture region is empty' })
    await assert.rejects(() => promise, /capture region is empty/)
  })

  it('ignores a line that is not JSON without losing the next response', async () => {
    const { sidecar, last } = setup()
    const promise = sidecar.call('ping')
    const child = last()
    child.writeRaw('not json at all\n')
    child.respond({ id: 1, ok: true, result: { pong: true } })
    assert.deepEqual(await promise, { pong: true })
  })

  it('reassembles a response split across two chunks', async () => {
    const { sidecar, last } = setup()
    const promise = sidecar.call('ping')
    const child = last()
    const line = JSON.stringify({ id: 1, ok: true, result: { pong: true } })
    child.writeRaw(line.slice(0, 10))
    child.writeRaw(`${line.slice(10)}\n`)
    assert.deepEqual(await promise, { pong: true })
  })
})

describe('computer sidecar: failure modes', () => {
  it('rejects when the helper never answers', async () => {
    const { sidecar } = setup(10)
    await assert.rejects(() => sidecar.call('capture'), /did not answer/)
  })

  it('fails everything in flight when the helper exits', async () => {
    const { sidecar, last } = setup()
    const first = sidecar.call('ping')
    const second = sidecar.call('ping')
    last().exit(1)
    await assert.rejects(() => first, /exited/)
    await assert.rejects(() => second, /exited/)
  })

  it('reports a helper that cannot start', async () => {
    const child = new FakeChild()
    const spawnProcess = (() => {
      // Emitting before the caller can attach a listener would be lost, so the
      // error is delivered on the next tick, as Node does.
      setImmediate(() => child.emit('error', new Error('ENOENT')))
      return child
    }) as unknown as typeof spawn

    const sidecar = createComputerSidecar({
      exePath: 'C:\\missing\\vespi-cua.exe',
      log: () => {},
      spawnProcess,
      defaultTimeoutMs: 50,
    })
    await assert.rejects(() => sidecar.call('ping'), /could not start/)
  })
})
