#!/usr/bin/env node
/**
 * MCP server that exposes VesPi's embedded browser panel to the agent.
 *
 * The panel is an Electron `<webview>`, so the kernel's CDP-based browser tools
 * can never reach it (they only accept `page` targets). VesPi can reach it, so
 * this server simply forwards tool calls to VesPi over the channel described in
 * `src/main/panel-channel.ts` — a Windows named pipe guarded by a per-launch
 * token, both handed to this process through the environment.
 *
 * Run by the app's own executable acting as Node (`ELECTRON_RUN_AS_NODE=1`), so
 * nothing extra has to be installed. See `src/main/agent-browser-mcp.ts`.
 *
 * Nothing here is optional machinery: no dependencies, no network, no state
 * beyond the pipe. If the pipe is gone the tools report a plain error, which is
 * what the model should pass on to the user.
 */
import http from 'node:http'

const PIPE = process.env.VESPI_PANEL_PIPE
const TOKEN = process.env.VESPI_PANEL_TOKEN

const TOOLS = [
  {
    name: 'panel_state',
    description:
      'Where the user-visible browser panel is: URL, title, whether it is still loading, and why it last failed. Call this first to see what is already open.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'panel_open',
    description:
      'Navigate the user-visible browser panel to an http(s) URL. The user watches this happen, so prefer it over driving a browser they cannot see when the page matters to them.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Absolute http(s) URL.' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'panel_reload',
    description: 'Reload the page currently in the user-visible browser panel.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'panel_back',
    description: 'Go back in the history of the user-visible browser panel.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'panel_forward',
    description: 'Go forward in the history of the user-visible browser panel.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'panel_eval',
    description:
      'Run JavaScript in the page shown in the panel and return the JSON-safe result. This is how you click, fill, and read specific values: await the expression if it returns a promise. Runs in the page only — there is no access to the app.',
    inputSchema: {
      type: 'object',
      properties: { expression: { type: 'string', description: 'JavaScript expression to evaluate.' } },
      required: ['expression'],
      additionalProperties: false,
    },
  },
  {
    name: 'panel_text',
    description:
      'Visible text of the page in the panel. Cheaper than reading HTML, and usually enough to answer a question about what the page says.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'panel_screenshot',
    description: 'Screenshot of the visible part of the panel, for when you need to see the page rather than read it.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function callPanel(op, payload) {
  return new Promise((resolve, reject) => {
    if (!PIPE || !TOKEN) {
      reject(new Error('VesPi panel channel is not configured (missing pipe or token)'))
      return
    }
    const body = JSON.stringify(payload ?? {})
    const req = http.request(
      {
        socketPath: PIPE,
        path: `/panel/${op}`,
        method: 'POST',
        headers: {
          'x-vespi-token': TOKEN,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let text = ''
        res.on('data', (chunk) => {
          text += chunk
        })
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`panel channel returned ${res.statusCode}`))
            return
          }
          try {
            const parsed = JSON.parse(text)
            if (parsed && parsed.ok) resolve(parsed.result)
            else reject(new Error((parsed && parsed.error) || 'panel operation failed'))
          } catch {
            reject(new Error('panel channel returned a malformed response'))
          }
        })
      }
    )
    req.on('error', (error) => reject(new Error(`panel channel unavailable: ${error.message}`)))
    req.end(body)
  })
}

function toolResult(result) {
  if (result && typeof result === 'object' && result.imagePngBase64) {
    return { content: [{ type: 'image', data: result.imagePngBase64, mimeType: 'image/png' }] }
  }
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? null, null, 2)
  return { content: [{ type: 'text', text }] }
}

function handleToolCall(params) {
  const name = String(params?.name ?? '')
  const args = params?.arguments ?? {}
  const op = name.replace(/^panel_/, '')
  if (name === 'panel_open') return callPanel('open', { url: args.url })
  if (name === 'panel_eval') return callPanel('eval', { expression: args.expression })
  if (name.startsWith('panel_')) return callPanel(op, {})
  throw new Error(`unknown tool: ${name}`)
}

async function handle(message) {
  const { id, method, params } = message
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'vespi-panel', version: '1.0.0' },
      },
    }
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
  if (method === 'tools/call') {
    try {
      return { jsonrpc: '2.0', id, result: toolResult(await handleToolCall(params)) }
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `panel operation failed: ${error.message}` }],
          isError: true,
        },
      }
    }
  }
  // Notifications carry no id and expect no reply.
  if (id === undefined) return null
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } }
}

let buffer = ''
process.stdin.setEncoding('utf-8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    void handle(message).then((reply) => {
      if (reply) send(reply)
    })
  }
})
