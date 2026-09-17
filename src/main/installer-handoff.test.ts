import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  beginInstallerHandover,
  confirmInstallerHandover,
  kernelProcessAlive,
  runInstallerHandover,
  setupInstallerHandoff,
  sweepSurvivingKernel,
  type InstallerHandoffDeps,
} from './installer-handoff'

/** Deps that record what they were asked to do, in order. */
function recorder() {
  const calls: string[] = []
  const deps = (overrides: Partial<InstallerHandoffDeps> = {}): InstallerHandoffDeps => ({
    confirmQuit: async () => {
      calls.push('confirmQuit')
      return true
    },
    markQuitting: () => calls.push('markQuitting'),
    releaseTray: () => calls.push('releaseTray'),
    stopKernel: async () => {
      calls.push('stopKernel')
    },
    beforeExit: () => calls.push('beforeExit'),
    exit: (code) => calls.push(`exit:${code}`),
    log: (message) => calls.push(`log:${message}`),
    ...overrides,
  })
  /** Only the meaningful steps — log lines are noise for order assertions. */
  const steps = (): string[] => calls.filter((call) => !call.startsWith('log:'))
  return { calls, deps, steps }
}

test('nothing is wired before setup, so a handover cannot be confirmed', async () => {
  assert.equal(await confirmInstallerHandover(), false)
})

test('the handover quits the tray and the kernel before leaving the process', async () => {
  const { deps, steps } = recorder()
  await runInstallerHandover(deps())

  // Quitting and tray release come first: a window close arriving during the
  // kernel stop must not hide to the tray and keep the app alive.
  assert.deepEqual(steps(), ['markQuitting', 'releaseTray', 'stopKernel', 'beforeExit', 'exit:0'])
})

test('a kernel that cannot be stopped does not keep the app alive', async () => {
  const { calls, deps, steps } = recorder()
  await runInstallerHandover(
    deps({
      stopKernel: async () => {
        throw new Error('simulated kill failure')
      },
    }),
  )

  // The whole point of the handover is leaving; a failure to tidy up must not
  // reproduce the stall it exists to fix.
  assert.deepEqual(steps(), ['markQuitting', 'releaseTray', 'beforeExit', 'exit:0'])
  assert.ok(calls.some((call) => call.includes('Could not stop the kernel')))
})

test('a failing flush does not stop the exit either', async () => {
  const { calls, deps, steps } = recorder()
  await runInstallerHandover(
    deps({
      beforeExit: () => {
        throw new Error('simulated flush failure')
      },
    }),
  )

  assert.deepEqual(steps(), ['markQuitting', 'releaseTray', 'stopKernel', 'exit:0'])
  assert.ok(calls.some((call) => call.includes('Could not flush state')))
})

test('a refused confirmation is reported to the caller', async () => {
  const { deps } = recorder()
  setupInstallerHandoff(deps({ confirmQuit: async () => false }))
  assert.equal(await confirmInstallerHandover(), false)

  setupInstallerHandoff(deps({ confirmQuit: async () => true }))
  assert.equal(await confirmInstallerHandover(), true)
})

test('the handover is armed once, however often the installer reports success', async () => {
  const { deps, steps } = recorder()
  setupInstallerHandoff(deps())

  beginInstallerHandover(0)
  beginInstallerHandover(0)
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.deepEqual(steps(), ['markQuitting', 'releaseTray', 'stopKernel', 'beforeExit', 'exit:0'])
})

test('no kernel sweep is attempted off Windows', async () => {
  // POSIX kills the whole process group plus the subagents it enumerated, so
  // the Windows-only sweep must stay out of the way.
  assert.equal(await kernelProcessAlive('linux'), false)
  assert.equal(await kernelProcessAlive('darwin'), false)
  assert.equal(await sweepSurvivingKernel({ platform: 'linux' }), true)
  assert.equal(await sweepSurvivingKernel({ platform: 'darwin' }), true)
})
