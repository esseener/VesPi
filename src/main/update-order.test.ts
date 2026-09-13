import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { createUpdateOrder } from './update-order'

/** A promise plus its resolvers, so a test can decide when work finishes. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Lets queued continuations run without waiting on real time. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('trackKernelApply', () => {
  // Two applies must never interleave: the swap is not reentrant.
  it('serializes overlapping applies', async () => {
    const order = createUpdateOrder()
    const events: string[] = []
    const first = deferred()
    const second = deferred()

    const a = order.trackKernelApply(async () => {
      events.push('a:start')
      await first.promise
      events.push('a:end')
    })
    const b = order.trackKernelApply(async () => {
      events.push('b:start')
      await second.promise
      events.push('b:end')
    })

    await tick()
    assert.deepEqual(events, ['a:start'], 'the second apply waits for the first')

    first.resolve()
    await tick()
    assert.deepEqual(events, ['a:start', 'a:end', 'b:start'])

    second.resolve()
    await Promise.all([a, b])
    assert.deepEqual(events, ['a:start', 'a:end', 'b:start', 'b:end'])
  })

  it('passes the result through', async () => {
    const order = createUpdateOrder()
    assert.equal(await order.trackKernelApply(async () => 42), 42)
  })

  // A failed apply must not block the next one.
  it('keeps the queue moving after a failure', async () => {
    const order = createUpdateOrder()
    await assert.rejects(() => order.trackKernelApply(async () => Promise.reject(new Error('boom'))), /boom/)
    assert.equal(await order.trackKernelApply(async () => 'still works'), 'still works')
  })

  it('keeps a rejection visible to its own caller', async () => {
    const order = createUpdateOrder()
    const failed = order.trackKernelApply(async () => {
      throw new Error('nope')
    })
    // Another caller joining later must not see it.
    const fine = order.trackKernelApply(async () => 'ok')
    await assert.rejects(() => failed, /nope/)
    assert.equal(await fine, 'ok')
  })
})

describe('waitForKernelApply', () => {
  it('resolves immediately when nothing is applying', async () => {
    const order = createUpdateOrder()
    await order.waitForKernelApply()
  })

  // The whole point: the UI installer must not start mid-swap.
  it('waits for a running apply to finish', async () => {
    const order = createUpdateOrder()
    const gate = deferred()
    let finished = false

    void order.trackKernelApply(async () => {
      await gate.promise
      finished = true
    })

    let waited = false
    const waiter = order.waitForKernelApply().then(() => {
      waited = true
    })

    await tick()
    assert.equal(waited, false, 'still applying')
    assert.equal(finished, false)

    gate.resolve()
    await waiter
    assert.equal(finished, true)
  })

  it('waits for queued work too, not just the apply in flight', async () => {
    const order = createUpdateOrder()
    const gate = deferred()
    const done: string[] = []

    void order.trackKernelApply(async () => {
      await gate.promise
      done.push('first')
    })
    void order.trackKernelApply(async () => {
      done.push('second')
    })

    const waiter = order.waitForKernelApply()
    gate.resolve()
    await waiter
    assert.deepEqual(done, ['first', 'second'])
  })

  it('does not reject when an apply failed', async () => {
    const order = createUpdateOrder()
    void order.trackKernelApply(async () => {
      throw new Error('boom')
    })
    await order.waitForKernelApply()
  })
})

describe('ui installer tracking', () => {
  it('starts false and flips once marked', () => {
    const order = createUpdateOrder()
    assert.equal(order.hasUiInstallerLaunched(), false)
    order.markUiInstallerLaunched()
    assert.equal(order.hasUiInstallerLaunched(), true)
  })
})
