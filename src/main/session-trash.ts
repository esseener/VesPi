import { spawnSync } from 'child_process'
import { join } from 'path'

/**
 * Moving a deleted session to the desktop trash instead of destroying it.
 *
 * Linux: try `trash` (trash-cli), then `gio trash` (GLib).
 * Windows: a fixed helper script under resources/recycle-to-bin.ps1; the
 * session path is a separate argv item, never concatenated into -Command.
 * If no helper works, the caller falls back to unlink.
 */

const TRASH_HELPERS: ReadonlyArray<{ command: string; leadingArgs: readonly string[] }> = [
  { command: 'trash', leadingArgs: [] },
  { command: 'gio', leadingArgs: ['trash'] },
]

const TRASH_EXIT_OK = 0

export const WINDOWS_RECYCLE_SCRIPT = 'recycle-to-bin.ps1'

export function windowsRecycleScriptPath(): string {
  // Packaged: extraResources copies resources/ to process.resourcesPath/resources/.
  // Dev / tests: sibling of src/main via ../../resources.
  const resourcesDir =
    typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0
      ? join(process.resourcesPath, 'resources')
      : join(__dirname, '../../resources')
  return join(resourcesDir, WINDOWS_RECYCLE_SCRIPT)
}

export function buildWindowsRecycleArgs(scriptPath: string, targetPath: string): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle',
    'Hidden',
    '-File',
    scriptPath,
    '-Path',
    targetPath,
  ]
}

export interface TrashSpawnResult {
  status: number | null
  error?: Error
}

export type TrashSpawn = (command: string, args: string[]) => TrashSpawnResult

function runTrashHelper(command: string, args: string[]): TrashSpawnResult {
  const result = spawnSync(command, args, { encoding: 'utf-8' })
  return { status: result.status, error: result.error }
}

export function buildTrashArgs(leadingArgs: readonly string[], targetPath: string): string[] {
  return targetPath.startsWith('-')
    ? [...leadingArgs, '--', targetPath]
    : [...leadingArgs, targetPath]
}

export function moveToTrash(
  targetPath: string,
  spawn: TrashSpawn = runTrashHelper,
  platform: NodeJS.Platform = process.platform,
  recycleScriptPath: string = windowsRecycleScriptPath(),
): boolean {
  if (platform === 'win32') {
    const result = spawn('powershell.exe', buildWindowsRecycleArgs(recycleScriptPath, targetPath))
    if (!result.error && result.status === TRASH_EXIT_OK) return true
    return false
  }

  for (const { command, leadingArgs } of TRASH_HELPERS) {
    const result = spawn(command, buildTrashArgs(leadingArgs, targetPath))
    if (result.error) continue
    if (result.status === TRASH_EXIT_OK) return true
  }
  return false
}
