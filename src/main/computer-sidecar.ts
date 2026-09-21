import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

/**
 * The live side of `native-cua`: VesPi's desktop-control helper.
 *
 * One long-lived child process, one JSON request per line, one response per line,
 * matched by `id`. The helper owns the Win32 work (windows, accessibility,
 * screenshots, input) because Electron cannot do it from the main process.
 *
 * Three behaviours worth knowing, all of which exist because the failure they
 * prevent is a hung agent:
 *
 * - **Lazy start.** Nothing is spawned until a request actually arrives, the same
 *   rule the agent browser follows. Starting a helper at app launch would cost
 *   every user a process for a feature most of them never turn on.
 * - **Every request is answered or times out.** A request that is never answered
 *   would park a model call forever; the timer is the backstop, and a helper that
 *   dies rejects everything still in flight rather than leaving it hanging.
 * - **A dead helper is not fatal.** The next call spawns a new one. Only an
 *   explicit `dispose()` (the setting being turned off) stops that.
 *
 * The Electron-free surface is deliberate: this is unit-testable with a fake
 * spawn, which is how the framing and timeout behaviour is covered.
 */

export interface ComputerSidecar {
  call(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>
  /** Whether a helper process is currently alive. Diagnostics only. */
  isRunning(): boolean
  /** Stop for good: kill the child and fail anything in flight. */
  dispose(): void
}

export interface ComputerSidecarDeps {
  /** Absolute path to `vespi-cua.exe`. */
  exePath: string
  log: (message: string, detail?: unknown) => void
  /** Injected for tests; defaults to `child_process.spawn`. */
  spawnProcess?: typeof spawn
  defaultTimeoutMs?: number
}

/**
 * Screenshots arrive as base64 and can legitimately be a few megabytes, so the
 * read buffer is generous — but still bounded, because an unbounded buffer on a
 * malfunctioning pipe is a memory leak that only shows up in the field.
 */
const MAX_BUFFER_CHARS = 64 * 1024 * 1024

const DEFAULT_TIMEOUT_MS = 20_000

/**
 * Screenshots and accessibility walks are slower than everything else: a big
 * window's UIA tree is tens of thousands of COM calls.
 */
export const SLOW_METHOD_TIMEOUT_MS = 45_000

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export function createComputerSidecar(deps: ComputerSidecarDeps): ComputerSidecar {
  const spawnProcess = deps.spawnProcess ?? spawn
  const defaultTimeout = deps.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS

  let child: ChildProcessWithoutNullStreams | null = null
  let buffer = ''
  let nextId = 1
  const pending = new Map<number, Pending>()

  function failAll(reason: string): void {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error(reason))
    }
    pending.clear()
  }

  function drain(): void {
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
      if (!line) continue

      let message: { id?: unknown; ok?: unknown; result?: unknown; error?: unknown }
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        deps.log('computer sidecar sent a line that is not JSON', line.slice(0, 200))
        continue
      }

      if (typeof message.id !== 'number') continue
      const entry = pending.get(message.id)
      if (!entry) continue
      pending.delete(message.id)
      clearTimeout(entry.timer)

      if (message.ok) entry.resolve(message.result)
      else {
        entry.reject(
          new Error(
            typeof message.error === 'string' ? message.error : 'the desktop helper refused the request'
          )
        )
      }
    }

    if (buffer.length > MAX_BUFFER_CHARS) {
      buffer = ''
      deps.log('computer sidecar output exceeded the buffer ceiling; dropping the connection')
      failAll('the desktop helper produced more output than could be read')
    }
  }

  function ensureChild(): ChildProcessWithoutNullStreams {
    if (child && child.exitCode === null && !child.killed) return child

    const spawned = spawnProcess(deps.exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      // No console window: the helper is a background process, and a flashing
      // black box on launch would be alarming.
      windowsHide: true,
    })

    spawned.stdout.setEncoding('utf-8')
    spawned.stdout.on('data', (chunk: string) => {
      buffer += chunk
      drain()
    })

    spawned.stderr.setEncoding('utf-8')
    spawned.stderr.on('data', (chunk: string) => {
      const text = String(chunk).trim()
      if (text) deps.log('computer sidecar wrote to stderr', text.slice(0, 500))
    })

    spawned.on('error', (error: Error) => {
      deps.log('computer sidecar could not start', error.message)
      failAll(`the desktop helper could not start: ${error.message}`)
      if (child === spawned) child = null
    })

    spawned.on('exit', (code: number | null) => {
      deps.log(`computer sidecar exited (code ${code ?? 'none'})`)
      failAll('the desktop helper exited before answering')
      buffer = ''
      if (child === spawned) child = null
    })

    child = spawned
    return spawned
  }

  function call(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs: number = defaultTimeout
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const running = ensureChild()
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`the desktop helper did not answer "${method}" within ${timeoutMs} ms`))
      }, timeoutMs)

      pending.set(id, { resolve, reject, timer })

      const payload = `${JSON.stringify({ id, method, params })}\n`
      running.stdin.write(payload, (error) => {
        if (!error) return
        const entry = pending.get(id)
        if (!entry) return
        pending.delete(id)
        clearTimeout(entry.timer)
        entry.reject(new Error(`could not reach the desktop helper: ${error.message}`))
      })
    })
  }

  return {
    call,
    isRunning: () => child !== null && child.exitCode === null && !child.killed,
    dispose: () => {
      const running = child
      child = null
      buffer = ''
      failAll('desktop control was turned off')
      if (running && running.exitCode === null) {
        // Kill rather than close stdin: a helper mid-capture would not notice.
        try {
          running.kill()
        } catch {
          // Already gone.
        }
      }
    },
  }
}
