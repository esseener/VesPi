import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import {
  PANEL_MAX_BODY_BYTES,
  PANEL_OPS,
  PANEL_PIPE_PREFIX,
  PANEL_TOKEN_HEADER,
  createPanelChannel,
  createPanelPipePath,
  createPanelToken,
  isPanelOp,
} from './panel-channel'

/** One request over the named pipe. Never rejects: transport failures are returned. */
function call(
  pipePath: string,
  path: string,
  options: { token?: string; body?: string; method?: string } = {}
): Promise<{ status: number | 'error'; body: string }> {
  return new Promise((resolve) => {
    const payload = options.body ?? ''
    const headers: Record<string, string> = {}
    if (options.token !== undefined) headers[PANEL_TOKEN_HEADER] = options.token
    if (payload) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(Buffer.byteLength(payload))
    }
    const req = http.request(
      { socketPath: pipePath, path, method: options.method ?? 'POST', headers },
      (res) => {
        let body = ''
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      }
    )
    req.on('error', () => resolve({ status: 'error', body: '' }))
    req.end(payload)
  })
}

/** A channel on its own pipe, plus a record of what the handler saw. */
async function makeChannel(handle?: (request: { op: string; payload: Record<string, unknown> }) => Promise<unknown>) {
  const pipePath = createPanelPipePath(randomBytes(6).toString('hex'))
  const token = createPanelToken()
  const seen: Array<{ op: string; payload: Record<string, unknown> }> = []
  const channel = await createPanelChannel({
    pipePath,
    token,
    handle:
      handle ??
      (async (request) => {
        seen.push(request)
        return { echoed: request.op }
      }),
  })
  return { channel, pipePath, token, seen }
}

describe('pipe path and token', () => {
  it('builds a pipe path under the VesPi prefix', () => {
    assert.equal(createPanelPipePath('abc123'), `${PANEL_PIPE_PREFIX}abc123`)
  })

  it('generates a different pipe path and token each time', () => {
    assert.notEqual(createPanelPipePath(), createPanelPipePath())
    assert.notEqual(createPanelToken(), createPanelToken())
    assert.ok(createPanelToken().length >= 32)
  })
})

describe('isPanelOp', () => {
  it('accepts exactly the documented operations', () => {
    for (const op of PANEL_OPS) assert.equal(isPanelOp(op), true, op)
  })

  // Nothing that touches the VesPi application UI belongs here.
  it('rejects anything else', () => {
    for (const bad of ['', 'ui', 'shell', 'opene', 'EVAL', '__proto__']) {
      assert.equal(isPanelOp(bad), false, bad)
    }
  })
})

describe('createPanelChannel', () => {
  it('routes an operation to the handler and returns its result', async () => {
    const { channel, pipePath, token, seen } = await makeChannel()

    const res = await call(pipePath, '/panel/eval', { token, body: JSON.stringify({ expression: 'document.title' }) })

    assert.equal(res.status, 200)
    assert.deepEqual(JSON.parse(res.body), { ok: true, result: { echoed: 'eval' } })
    assert.deepEqual(seen, [{ op: 'eval', payload: { expression: 'document.title' } }])

    await channel.close()
  })

  it('accepts an empty body as an empty payload', async () => {
    const { channel, pipePath, token, seen } = await makeChannel()
    const res = await call(pipePath, '/panel/state', { token })
    assert.equal(res.status, 200)
    assert.deepEqual(seen[0]?.payload, {})
    await channel.close()
  })

  // The token is the only thing standing between a stray local process and the
  // panel, so a wrong token must not reach the handler.
  it('refuses a wrong token without calling the handler', async () => {
    const { channel, pipePath, seen } = await makeChannel()
    const res = await call(pipePath, '/panel/state', { token: 'wrong' })
    assert.equal(res.status, 403)
    assert.deepEqual(seen, [])
    await channel.close()
  })

  it('refuses a missing token', async () => {
    const { channel, pipePath, seen } = await makeChannel()
    const res = await call(pipePath, '/panel/state', {})
    assert.equal(res.status, 403)
    assert.deepEqual(seen, [])
    await channel.close()
  })

  it('refuses an unknown operation', async () => {
    const { channel, pipePath, token, seen } = await makeChannel()
    const res = await call(pipePath, '/panel/destroyVespi', { token })
    assert.equal(res.status, 404)
    assert.deepEqual(seen, [])
    await channel.close()
  })

  it('refuses anything that is not a POST', async () => {
    const { channel, pipePath, token } = await makeChannel()
    const res = await call(pipePath, '/panel/state', { token, method: 'GET' })
    assert.equal(res.status, 405)
    await channel.close()
  })

  it('rejects a body that is not valid JSON', async () => {
    const { channel, pipePath, token, seen } = await makeChannel()
    const res = await call(pipePath, '/panel/eval', { token, body: '{ not json' })
    assert.equal(res.status, 400)
    assert.deepEqual(seen, [])
    await channel.close()
  })

  it('rejects a JSON body that is not an object', async () => {
    const { channel, pipePath, token, seen } = await makeChannel()
    const res = await call(pipePath, '/panel/eval', { token, body: '[1,2,3]' })
    assert.equal(res.status, 400)
    assert.deepEqual(seen, [])
    await channel.close()
  })

  it('rejects an oversized body instead of buffering it', async () => {
    const { channel, pipePath, token } = await makeChannel()
    const res = await call(pipePath, '/panel/eval', {
      token,
      body: JSON.stringify({ expression: 'x'.repeat(PANEL_MAX_BODY_BYTES + 100) }),
    })
    assert.equal(res.status, 413)
    await channel.close()
  })

  // A failing operation is reported to the caller, not swallowed as a transport
  // error: the model needs to read what went wrong and tell the user.
  it('reports a handler failure as a readable result', async () => {
    const { channel, pipePath, token } = await makeChannel(async () => {
      throw new Error('panel is not open')
    })
    const res = await call(pipePath, '/panel/text', { token })
    assert.equal(res.status, 200)
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: 'panel is not open' })
    await channel.close()
  })

  // A gone pipe must read as a clean failure, never as a hang.
  it('stops accepting once closed', async () => {
    const { channel, pipePath, token } = await makeChannel()
    await channel.close()
    const res = await call(pipePath, '/panel/state', { token })
    assert.equal(res.status, 'error')
  })
})
