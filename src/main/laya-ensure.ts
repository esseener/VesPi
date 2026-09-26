/**
 * Ensure bundled Laya is materialized into an app-local venv.
 * Never installs to global Python / PATH — lives under resources/laya/venv
 * or %LOCALAPPDATA%/VesPi/laya when resources is read-only (installed app).
 */
import { spawn } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export function layaRoot(): string {
  const res = (process as { resourcesPath?: string }).resourcesPath
  if (res && existsSync(join(res, 'laya'))) return join(res, 'laya')
  return join(process.cwd(), 'resources', 'laya')
}

export function layaVenvPython(): string | null {
  const root = layaRoot()
  const win = join(root, 'venv', 'Scripts', 'python.exe')
  const posix = join(root, 'venv', 'bin', 'python')
  if (existsSync(win)) return win
  if (existsSync(posix)) return posix
  return null
}

/** Run bootstrap.cmd once. Returns venv python path or null. */
export async function ensureLaya(): Promise<string | null> {
  const existing = layaVenvPython()
  if (existing) return existing
  const root = layaRoot()
  const bootstrap = join(root, 'bootstrap.cmd')
  if (!existsSync(bootstrap)) return null
  mkdirSync(root, { recursive: true })
  await new Promise<void>((resolve) => {
    const child = spawn('cmd.exe', ['/c', bootstrap], {
      cwd: root,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('exit', () => resolve())
    child.on('error', () => resolve())
  })
  return layaVenvPython()
}
