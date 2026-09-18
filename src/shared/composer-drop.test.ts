import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { attachableDropPaths, type DropPayload } from './composer-drop'

/** Minimal DataTransfer stand-in: only what the helper reads. */
function makeTransfer(
  items: Array<{ kind?: string; isDirectory?: boolean; throws?: boolean }>,
  files: string[]
): DropPayload {
  return {
    items: items.map((item) => ({
      kind: item.kind ?? 'file',
      webkitGetAsEntry: (): { isDirectory?: boolean } | null => {
        if (item.throws) throw new Error('entry probe failed')
        return item.kind === 'string' ? null : { isDirectory: item.isDirectory === true }
      },
    })),
    files: files.map((path) => ({ path })),
  }
}

const pathOf = (file: unknown): string => (file as { path: string }).path

describe('attachableDropPaths', () => {
  it('claims plain file drops and returns their paths', () => {
    const transfer = makeTransfer([{ isDirectory: false }, { isDirectory: false }], ['C:\\a\\one.ts', 'C:\\a\\two.md'])
    assert.deepEqual(attachableDropPaths(transfer, pathOf), ['C:\\a\\one.ts', 'C:\\a\\two.md'])
  })

  it('hands a directory drop back to the workspace opener', () => {
    // use-folder-drop.ts opens directories as workspaces; attaching them as
    // conversation attachments would be wrong twice over.
    const transfer = makeTransfer([{ isDirectory: true }], ['C:\\projects\\app'])
    assert.deepEqual(attachableDropPaths(transfer, pathOf), [])
  })

  it('hands back a mixed drop too: a folder anywhere in it is a folder drop', () => {
    const transfer = makeTransfer([{ isDirectory: false }, { isDirectory: true }], ['C:\\a\\x.md', 'C:\\projects\\app'])
    assert.deepEqual(attachableDropPaths(transfer, pathOf), [])
  })

  it('ignores non-file payloads (dragged text, selections)', () => {
    const transfer = makeTransfer([{ kind: 'string' }], [])
    assert.deepEqual(attachableDropPaths(transfer, pathOf), [])
  })

  it('returns nothing for an empty or missing transfer', () => {
    assert.deepEqual(attachableDropPaths(null, pathOf), [])
    assert.deepEqual(attachableDropPaths(undefined, pathOf), [])
    assert.deepEqual(attachableDropPaths(makeTransfer([], []), pathOf), [])
  })

  it('treats an unprobeable entry as a file rather than swallowing the drop', () => {
    // webkitGetAsEntry can throw or return null; the drop must still land.
    const throwing = makeTransfer([{ throws: true }], ['C:\\a\\x.md'])
    assert.deepEqual(attachableDropPaths(throwing, pathOf), ['C:\\a\\x.md'])
    const noEntry = { items: [{ kind: 'file' }], files: [{ path: 'C:\\a\\y.md' }] }
    assert.deepEqual(attachableDropPaths(noEntry, pathOf), ['C:\\a\\y.md'])
  })

  it('drops paths the platform could not resolve', () => {
    // webUtils.getPathForFile returns "" for a virtual file; attaching it would
    // produce an empty upload.
    const transfer = makeTransfer([{ isDirectory: false }], ['', 'C:\\a\\ok.md'])
    assert.deepEqual(attachableDropPaths(transfer, pathOf), ['C:\\a\\ok.md'])
  })
})
