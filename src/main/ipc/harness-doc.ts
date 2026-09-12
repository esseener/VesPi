import { existsSync } from 'fs'

/**
 * Flag the kernel resolves by *reading a file* when the value has no newline,
 * and by taking the value as inline text when it does. VesPi passes a path so
 * the shell context stays editable on disk instead of being baked into argv.
 */
export const APPEND_SYSTEM_PROMPT_FLAG = '--append-system-prompt'

/**
 * True when the caller already named this flag (either the `--flag value` or
 * `--flag=value` form), so the shell must not append its own.
 */
export function hasArgFlag(args: string[], name: string): boolean {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`))
}

/**
 * Append the shell-context document to a start's argv, unless the caller
 * already named the flag — that is the documented escape hatch for a custom
 * prompt — or the document is missing.
 *
 * A missing file must not be passed through: the kernel falls back to treating
 * an unreadable value as literal inline text, which would inject a stray path
 * string into the system prompt.
 *
 * Kept pure and path-injected so it is testable without loading Electron
 * (`app.isPackaged` throws in a plain Node process, so the module that resolves
 * the real paths cannot be imported by a test).
 */
export function withHarnessDoc(
  args: string[],
  harnessDocPath: string | null,
  pathExists: (path: string) => boolean = existsSync
): string[] {
  if (!harnessDocPath) return args
  if (hasArgFlag(args, APPEND_SYSTEM_PROMPT_FLAG)) return args
  if (!pathExists(harnessDocPath)) return args
  return [...args, APPEND_SYSTEM_PROMPT_FLAG, harnessDocPath]
}
