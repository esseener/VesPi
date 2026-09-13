import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'

/**
 * The channel the OMP kernel uses to drive VesPi's browser panel.
 *
 * Why a channel at all: the panel is an Electron `<webview>`, whose CDP target
 * type is `webview`. The kernel's browser tools speak CDP and only accept `page`
 * targets, so it can never reach the panel that way — verified against both OMP
 * 18.1.17 and 18.1.18. VesPi, however, already holds the panel's `webContents`
 * (it receives it in `did-attach-webview`), so VesPi can drive the panel
 * directly through Electron's own API and expose that as tools.
 *
 * Transport choices, both deliberate:
 *
 * - **A Windows named pipe, not a TCP port.** Nothing is reachable from the
 *   network and there is no listening port to discover. A pipe that is gone
 *   fails with `ENOENT`, which reads as a clean error rather than a hang.
 * - **A random token per launch**, passed only to the child process VesPi
 *   spawns, so a stray local process cannot drive the panel even if it guesses
 *   the pipe name.
 *
 * Kept free of Electron imports so the transport is unit-testable.
 */
export const PANEL_TOKEN_HEADER = 'x-vespi-token'

export const PANEL_PIPE_PREFIX = '\\\\.\\pipe\\vespi-panel-'

/**
 * The operations the kernel may ask for. Deliberately the panel's own
 * affordances plus page-level evaluation — and nothing that touches the VesPi
 * application UI.
 */
export const PANEL_OPS = ['state', 'open', 'reload', 'back', 'forward', 'eval', 'text', 'screenshot'] as const

export type PanelOp = (typeof PANEL_OPS)[number]

export function isPanelOp(value: string): value is PanelOp {
  return (PANEL_OPS as readonly string[]).includes(value)
}

/** Largest request body accepted, so a runaway caller cannot exhaust memory. */
export const PANEL_MAX_BODY_BYTES = 1_000_000

export interface PanelRequest {
  op: PanelOp
  payload: Record<string, unknown>
}

export type PanelHandler = (request: PanelRequest) => Promise<unknown>

export interface PanelChannel {
  path: string
  token: string
  close: () => Promise<void>
}

export function createPanelPipePath(random: string = randomBytes(6).toString('hex')): string {
  return `${PANEL_PIPE_PREFIX}${random}`
}

export function createPanelToken(random: string = randomBytes(16).toString('hex')): string {
  return random
}

function respond(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(text)
}

/**
 * Start listening. Resolves once the pipe is accepting connections, so a caller
 * cannot hand the kernel a pipe that is not up yet.
 */
export function createPanelChannel(options: {
  pipePath: string
  token: string
  handle: PanelHandler
  createServerFn?: typeof createServer
}): Promise<PanelChannel> {
  const makeServer = options.createServerFn ?? createServer

  const server: Server = makeServer((req, res) => {
    if (req.method !== 'POST') {
      respond(res, 405, { error: 'POST only' })
      return
    }
    if (req.headers[PANEL_TOKEN_HEADER] !== options.token) {
      respond(res, 403, { error: 'bad token' })
      return
    }
    const op = (req.url ?? '').replace(/^\/+/, '').replace(/^panel\//, '')
    if (!isPanelOp(op)) {
      respond(res, 404, { error: `unknown operation: ${op || '(none)'}` })
      return
    }

    let body = ''
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      body += chunk.toString('utf-8')
      if (body.length > PANEL_MAX_BODY_BYTES) {
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
        .then((result) => {
          respond(res, 200, { ok: true, result: result ?? null })
        })
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
