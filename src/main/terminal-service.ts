import { existsSync, readFileSync, mkdirSync } from 'fs'
import os from 'os'
import path from 'path'
import type { IPty } from 'node-pty'
import type { TerminalStartOptions, TerminalStartResult } from '../shared/ipc-contracts'

/** Absolute path of bundled omp.exe, or null. */
function bundledOmpExe(): string | null {
  const exe = process.platform === 'win32' ? 'omp.exe' : 'omp'
  const dir = bundledOmpDir()
  return dir ? path.join(dir, exe) : null
}

/** Directory that holds the bundled `omp.exe` (never written to global PATH). */
function bundledOmpDir(): string | null {
  const exe = process.platform === 'win32' ? 'omp.exe' : 'omp'
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'runtime', 'omp') : null,
    path.join(path.dirname(process.execPath), 'runtime', 'omp'),
    path.join(process.cwd(), 'runtime', 'omp'),
    path.join(process.cwd(), '..', 'runtime', 'omp'),
  ].filter((p): p is string => Boolean(p))
  for (const dir of candidates) {
    if (existsSync(path.join(dir, exe))) return dir
  }
  return null
}

type TerminalDataHandler = (data: string) => void
type TerminalExitHandler = (event: { exitCode: number; signal?: number }) => void

export interface TerminalRuntimeOptions {
  executable?: string
  continueSession?: boolean
  model?: string
  args?: string[]
  env?: Record<string, string>
}

let ptyModule: typeof import('node-pty') | null = null

async function loadPty(): Promise<typeof import('node-pty')> {
  if (ptyModule) return ptyModule
  try {
    const loaded = await import('node-pty')
    const pty = ('default' in loaded && loaded.default ? loaded.default : loaded) as typeof import('node-pty')
    if (typeof pty.spawn !== 'function') {
      throw new Error('node-pty.spawn is missing')
    }
    ptyModule = pty
    return pty
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Terminal native module failed to load: ${detail}`, { cause: err })
  }
}

export class TerminalService {
  private terminal: IPty | null = null
  private generation = 0
  private disposables: { dispose(): void }[] = []
  private cwd = os.homedir()
  private lastStart: {
    options: TerminalStartOptions
    onData: TerminalDataHandler
    onExit: TerminalExitHandler
    runtime: TerminalRuntimeOptions
  } | null = null

  constructor(
    private readonly loadTerminal: typeof loadPty = loadPty,
    private readonly sessionExists: (path: string) => boolean = existsSync
  ) {}

  async start(
    options: TerminalStartOptions,
    onData: TerminalDataHandler,
    onExit: TerminalExitHandler,
    resumeSessionPath?: string | null,
    restartOptions?: TerminalRuntimeOptions
  ): Promise<TerminalStartResult> {
    this.stop()
    const generation = this.generation
    this.lastStart = { options, onData, onExit, runtime: restartOptions ?? {} }

    const shell = getShell()
    const cwd = getCwd(options.cwd)
    const env = {
      ...process.env,
      ...restartOptions?.env,
      TERM: 'xterm-256color',
    } as Record<string, string>
    if (env.VESPI_TUI_STATE_FILE) mkdirSync(path.dirname(env.VESPI_TUI_STATE_FILE), { recursive: true })
    // Put the bundled OMP on this terminal's PATH so `omp` actually launches
    // the kernel (the desktop never writes a global PATH).
    const ompDir = bundledOmpDir()
    if (ompDir) {
      const key = process.platform === 'win32' ? 'Path' : 'PATH'
      const current = env[key] ?? env.PATH ?? env.Path ?? ''
      env[key] = ompDir + (current ? path.delimiter + current : '')
      if (process.platform === 'win32') {
        env.PATH = env[key]
        env.Path = env[key]
      }
    }




    const pty = await this.loadTerminal()
    // A newer start or stop owns the terminal after an asynchronous module load.
    if (generation !== this.generation) throw new Error('Terminal start cancelled')
    this.cwd = cwd
    // 启动 OMP 本体（TUI），不在 shell 里敲命令，避免回显 `omp --profile …`
    const ompExe = restartOptions?.executable || bundledOmpExe()
    if (!ompExe || !existsSync(ompExe)) throw new Error('OMP executable is missing. Check the runtime installation.')
    const spawnBin = ompExe ?? shell
    const spawnArgs = ompExe ? ['--profile', 'vespi'] : []
    // Let OMP restore the session before painting. Timed /resume keystrokes
    // race startup and can land in a different workspace after a switch.
    if (ompExe && resumeSessionPath && this.sessionExists(resumeSessionPath)) spawnArgs.push('--resume', resumeSessionPath)
    else if (ompExe && !resumeSessionPath && restartOptions?.continueSession) spawnArgs.push('--continue')
    if (ompExe && restartOptions?.model) spawnArgs.push('--model', restartOptions.model)
    if (ompExe && restartOptions?.args) spawnArgs.push(...restartOptions.args)
    const terminal = pty.spawn(spawnBin, spawnArgs, {
      name: 'xterm-256color',
      cols: terminalDimension(options.cols, 80),
      rows: terminalDimension(options.rows, 24),
      cwd,
      env,
      ...(process.platform === 'win32' ? {} : { encoding: 'utf8' }),
    })
    this.terminal = terminal

    this.disposables.push(terminal.onData(onData))
    this.disposables.push(
      terminal.onExit(({ exitCode, signal }) => {
        // Guard against a stale exit from a killed pty clobbering a terminal
        // that has since been recreated (e.g. after a view round-trip).
        if (this.terminal !== terminal) return
        this.terminal = null
        for (const disposable of this.disposables) disposable.dispose()
        this.disposables = []
        onExit({ exitCode, signal })
      })
    )

    return {
      pid: terminal.pid,
      shell: spawnBin,
      cwd,
    }
  }

  write(data: string): void {
    this.terminal?.write(data)
  }

  /**
   * Restart the PTY with the previous start options (cwd / size / handlers).
   * Used after OMP profile config changes so the TUI re-reads theme / model.
   * `resumeSessionPath` attaches the new TUI to an existing session file —
   * never spawn a fresh empty session for a settings change.
   */
  async restart(opts?: TerminalRuntimeOptions & { resumeSessionPath?: string | null }): Promise<TerminalStartResult | null> {
    if (!this.lastStart) return null
    const { options, onData, onExit, runtime } = this.lastStart
    return this.start(options, onData, onExit, opts?.resumeSessionPath, { ...runtime, ...opts, model: opts?.model ?? runtime.model })
  }

  resize(cols: number, rows: number): void {
    if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 && cols <= 32767 && rows <= 32767) {
      if (this.lastStart) this.lastStart.options = { ...this.lastStart.options, cols, rows }
      this.terminal?.resize(cols, rows)
    }
  }

  stop(): void {
    this.generation++
    this.lastStart = null
    // Detach handlers before killing so the resulting exit event neither
    // broadcasts a spurious "process exited" into a freshly-created terminal
    // nor nulls it out. See the identity guard in start().
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    const terminal = this.terminal
    this.terminal = null
    terminal?.kill()
  }

  getCwd(): string {
    return this.cwd
  }

  isRunning(): boolean { return this.terminal !== null }

  getPid(): number | null { return this.terminal?.pid ?? null }

  getSessionState(): { sessionPath: string | null; model: string | null; thinkingLevel: string | null; busy: boolean; completed: number } | null {
    const file = this.lastStart?.runtime.env?.VESPI_TUI_STATE_FILE
    if (!file || !this.terminal) return null
    try {
      const state = JSON.parse(readFileSync(file, 'utf-8'))
      if (state.pid !== this.terminal.pid) return null
      return {
        sessionPath: typeof state.sessionPath === 'string' ? state.sessionPath : null,
        model: typeof state.model === 'string' ? state.model : null,
        thinkingLevel: typeof state.thinkingLevel === 'string' ? state.thinkingLevel : null,
        busy: state.busy === true,
        completed: Number.isInteger(state.completed) ? state.completed : 0,
      }
    } catch { return null }
  }
}

function terminalDimension(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 && value <= 32767 ? value : fallback
}

function getShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC ?? 'powershell.exe'
  }
  return process.env.SHELL ?? '/bin/bash'
}

function getCwd(cwd?: string): string {
  if (cwd && existsSync(cwd)) return cwd
  return os.homedir()
}
