import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'

/**
 * The channel the OMP kernel uses to reach desktop control.
 *
 * Same transport decision as the browser panel's channel, for the same reasons:
 * a Windows named pipe (nothing on the network, no port to discover, and a pipe
 * that is gone fails as `ENOENT` rather than hanging) and a random token per
 * launch, handed only to the child process VesPi spawns.
 *
 * That token matters more here than it does for the panel. A stray local process
 * that guessed the pipe name could otherwise type into a banking window and click
 * Send. The token is the only thing standing in the way, so it is per-launch and
 * never written to disk.
 *
 * Kept free of Electron imports so the transport is unit-testable.
 */

export const COMPUTER_TOKEN_HEADER = 'x-vespi-token'

export const COMPUTER_PIPE_PREFIX = '\\\\.\\pipe\\vespi-computer-'

/** Requests are small (coordinates, a window handle); anything larger is a bug. */
export const COMPUTER_MAX_BODY_BYTES = 256_000

export interface ComputerRequest {
  op: string
  payload: Record<string, unknown>
}

export type ComputerHandler = (request: ComputerRequest) => Promise<unknown>

export interface ComputerChannel {
  path: string
  token: string
  close: () => Promise<void>
}

export function createComputerPipePath(random: string = randomBytes(6).toString('hex')): string {
  return `${COMPUTER_PIPE_PREFIX}${random}`
}

export function createComputerToken(random: string = randomBytes(16).toString('hex')): string {
  return random
}

function respond(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * Start listening. Resolves only once the pipe accepts connections, so the caller
 * cannot hand the kernel a pipe that is not up yet.
 *
 * The op is NOT validated here: the handler owns the operation table, and having
 * one place decide what exists keeps this transport reusable.
 */
export function createComputerChannel(options: {
  pipePath: string
  token: string
  handle: ComputerHandler
  createServerFn?: typeof createServer
}): Promise<ComputerChannel> {
  const makeServer = options.createServerFn ?? createServer

  const server: Server = makeServer((req, res) => {
    if (req.method !== 'POST') {
      respond(res, 405, { error: 'POST only' })
      return
    }
    if (req.headers[COMPUTER_TOKEN_HEADER] !== options.token) {
      respond(res, 403, { error: 'bad token' })
      return
    }

    const op = (req.url ?? '').replace(/^\/+/, '').replace(/^computer\//, '')
    if (!op) {
      respond(res, 404, { error: 'no operation given' })
      return
    }

    let body = ''
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      body += chunk.toString('utf-8')
      if (body.length > COMPUTER_MAX_BODY_BYTES) {
        tooLarge = true
        respond(res, 413, { error: 'request body too large' })
      }
    })
    req.on('end', () => {
      if (tooLarge) return
      let payload: Record<string, unknown> = {}
      if (body.trim()) {
        try {
          const parsed: unknown = JSON.parse(body)
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            respond(res, 400, { error: 'payload must be a JSON object' })
            return
          }
          payload = parsed as Record<string, unknown>
        } catch {
          respond(res, 400, { error: 'payload is not valid JSON' })
          return
        }
      }

      void options
        .handle({ op, payload })
        .then((result) => respond(res, 200, { ok: true, result: result ?? null }))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          respond(res, 200, { ok: false, error: message })
        })
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.pipePath, () => {
      server.removeListener('error', reject)
      resolve({
        path: options.pipePath,
        token: options.token,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          }),
      })
    })
  })
}
