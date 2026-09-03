import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTrashArgs, buildWindowsRecycleArgs, moveToTrash, type TrashSpawn, type TrashSpawnResult } from './session-trash'

/**
 * A deleted session must land in the desktop trash whenever the machine can
 * offer one. Linux: trash-cli then gio. Windows: recycle-to-bin.ps1 via
 * PowerShell -File so the path is a separate argv item.
 */

const NOT_INSTALLED: TrashSpawnResult = { status: null, error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) }
const SUCCEEDED: TrashSpawnResult = { status: 0 }
const REFUSED: TrashSpawnResult = { status: 1 }

function recordingSpawn(replies: Record<string, TrashSpawnResult>): { spawn: TrashSpawn; calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = []
  const spawn: TrashSpawn = (command, args) => {
    calls.push({ command, args })
    return replies[command] ?? NOT_INSTALLED
  }
  return { spawn, calls }
}

test('trash-cli is used when it is installed, and nothing else is tried', () => {
  const { spawn, calls } = recordingSpawn({ trash: SUCCEEDED })
  assert.equal(moveToTrash('/home/u/.pi/agent/sessions/p/a.jsonl', spawn, 'linux'), true)
  assert.deepEqual(calls.map((c) => c.command), ['trash'])
})

test('a missing trash-cli falls through to gio instead of failing', () => {
  const { spawn, calls } = recordingSpawn({ trash: NOT_INSTALLED, gio: SUCCEEDED })
  assert.equal(moveToTrash('/home/u/.omp/agent/sessions/p/a.jsonl', spawn, 'linux'), true)
  assert.deepEqual(calls.map((c) => c.command), ['trash', 'gio'])
  assert.deepEqual(calls[1].args, ['trash', '/home/u/.omp/agent/sessions/p/a.jsonl'])
})

test('no helper installed reports failure so the caller can decide', () => {
  const { spawn, calls } = recordingSpawn({})
  assert.equal(moveToTrash('/home/u/.pi/agent/sessions/p/a.jsonl', spawn, 'linux'), false)
  assert.deepEqual(calls.map((c) => c.command), ['trash', 'gio'])
})

test('a helper that runs and refuses is not treated as success', () => {
  const { spawn } = recordingSpawn({ trash: REFUSED, gio: REFUSED })
  assert.equal(moveToTrash('/home/u/.pi/agent/sessions/p/a.jsonl', spawn, 'linux'), false)
})

test('a refusal by one helper still lets the next one try', () => {
  const { spawn, calls } = recordingSpawn({ trash: REFUSED, gio: SUCCEEDED })
  assert.equal(moveToTrash('/home/u/.pi/agent/sessions/p/a.jsonl', spawn, 'linux'), true)
  assert.deepEqual(calls.map((c) => c.command), ['trash', 'gio'])
})

test('a path that could read as an option is separated with --', () => {
  assert.deepEqual(buildTrashArgs([], '-weird.jsonl'), ['--', '-weird.jsonl'])
  assert.deepEqual(buildTrashArgs(['trash'], '-weird.jsonl'), ['trash', '--', '-weird.jsonl'])
})

test('Windows uses PowerShell -File with the path as a separate argument', () => {
  const script = 'C:\\app\\resources\\recycle-to-bin.ps1'
  const target = 'C:\\Users\\u\\.omp\\profiles\\vespi\\agent\\sessions\\a.jsonl'
  const { spawn, calls } = recordingSpawn({ 'powershell.exe': SUCCEEDED, trash: SUCCEEDED, gio: SUCCEEDED })
  assert.equal(moveToTrash(target, spawn, 'win32', script), true)
  assert.deepEqual(calls.map((c) => c.command), ['powershell.exe'])
  assert.deepEqual(calls[0].args, buildWindowsRecycleArgs(script, target))
  assert.equal(calls[0].args.includes('-File'), true)
  assert.equal(calls[0].args.includes('-Command'), false)
})

test('Windows recycle args keep the session path as its own argv item', () => {
  const script = '/resources/recycle-to-bin.ps1'
  const target = "C:\\Users\\O'Brien\\a.jsonl"
  const args = buildWindowsRecycleArgs(script, target)
  assert.equal(args[args.length - 1], target)
  assert.equal(args[args.length - 2], '-Path')
})

test('an ordinary absolute path is passed without a separator', () => {
  assert.deepEqual(buildTrashArgs([], '/home/u/a.jsonl'), ['/home/u/a.jsonl'])
  assert.deepEqual(buildTrashArgs(['trash'], '/home/u/a.jsonl'), ['trash', '/home/u/a.jsonl'])
})
