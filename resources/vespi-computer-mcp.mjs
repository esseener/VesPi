#!/usr/bin/env node
/**
 * MCP server that exposes the user's desktop to the agent.
 *
 * A bridge, not an implementation: the actual work happens in `vespi-cua.exe`,
 * reached through VesPi's named-pipe channel (see `src/main/computer-channel.ts`).
 * This process only translates MCP tool calls into channel requests, the same way
 * `vespi-panel-mcp.mjs` does for the browser panel.
 *
 * Two things in here are the product, not plumbing:
 *
 * - **`instructions`**, returned at initialise time. It is the only place the
 *   model is told the shape of the task: look before you touch, prefer element
 *   ids to coordinates, never drive VesPi itself. Tool descriptions alone cannot
 *   carry that ordering.
 * - **`computer_uitree`**, which is what makes this usable by a model that cannot
 *   see images. A text-only model drives an application by reading named controls
 *   and acting on their ids. Screenshots are the fallback for UI that has no
 *   accessibility tree, not the primary route.
 *
 * Run by the app's own executable acting as Node (`ELECTRON_RUN_AS_NODE=1`), so
 * nothing extra has to be installed.
 */
import http from 'node:http'

const PIPE = process.env.VESPI_COMPUTER_PIPE
const TOKEN = process.env.VESPI_COMPUTER_TOKEN

const TARGET = {
  handle: { type: 'integer', description: 'Window handle from computer_windows. Preferred: it survives the list changing.' },
  window: { type: 'integer', description: 'Index into the most recent computer_windows result. Breaks if the list changed.' },
}

const INSTRUCTIONS = `You are operating the user's real desktop, not a sandbox: these tools move their mouse, type with their keyboard, and can click anything they can click.

Work in this order:
1. computer_windows to see what is open, then keep using the handle you picked.
2. computer_uitree to read the named controls in that window, then computer_invoke by id. This is the reliable path and the only one that works without seeing the screen.
3. computer_capture only when the window has no usable accessibility tree (games, canvases, image-only UI), then click by coordinate.

Rules that matter:
- Never drive VesPi's own window. The user is working in it; a synthetic click there can lose their work. Its rows are marked actionable: false.
- Coordinates are physical pixels. A screenshot is scaled: screen coordinate = origin + imagePixel x scale, both of which come back with the image. Re-read them after anything moves; a stale coordinate clicks whatever is there now.
- Reads are free. Look again rather than assuming — a window that moved, a menu that closed, a page that scrolled.
- If a call is refused, the refusal is the answer. Do not retry the same call; tell the user what was blocked and why.
- When you change something (typed, clicked, closed), say so plainly in your reply. The user cannot see the queue of tool calls the way you can.`

const TOOLS = [
  {
    name: 'computer_screen',
    description:
      'The desktop itself: size, how many monitors, and where the cursor is. Every coordinate in this toolset is a physical pixel in this space. Worth reading once before clicking, especially on a multi-monitor machine.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'computer_windows',
    description:
      'The visible windows on the desktop: title, process, handle, position and which one has focus. Call this first, and pass the handle you choose to the other computer tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'computer_focus',
    description:
      'Bring a window to the front, restoring it if it is minimized. Reports whether it actually became foreground — Windows sometimes refuses, and then a click or keystroke would go somewhere else.',
    inputSchema: { type: 'object', properties: { ...TARGET }, additionalProperties: false },
  },
  {
    name: 'computer_uitree',
    description:
      'The named controls inside a window — buttons, fields, list items, links — as text, each with an id, role, name and position. Read this before trying to click anything: it tells you what the window actually offers, and ids keep working when the window moves. It is also the only route for a model that cannot see images.',
    inputSchema: {
      type: 'object',
      properties: { ...TARGET, max: { type: 'integer', description: 'Maximum controls to return (default 300).' } },
      additionalProperties: false,
    },
  },
  {
    name: 'computer_invoke',
    description:
      'Activate one control by the id computer_uitree gave it. Uses the control\'s own accessibility action when it has one — that works even when the window is not in front and never moves the user\'s mouse — and falls back to clicking its centre. Always prefer this over computer_click for a named control.',
    inputSchema: {
      type: 'object',
      properties: { ...TARGET, element: { type: 'integer', description: 'The id from computer_uitree.' } },
      required: ['element'],
      additionalProperties: false,
    },
  },
  {
    name: 'computer_capture',
    description:
      'An image of a window, or of the whole desktop when no window is given. Use it when computer_uitree comes back empty or useless. The image is scaled and it returns origin and scale with it: screen coordinate = origin + imagePixel x scale. Only useful if you can see images; a text-only model should stay with computer_uitree.',
    inputSchema: {
      type: 'object',
      properties: { ...TARGET, max: { type: 'integer', description: 'Long edge of the returned image, default 1280.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'computer_click',
    description:
      'Click a screen coordinate. Last resort: prefer computer_invoke for a named control, because coordinates stop meaning anything the moment the window moves. Reads the position from computer_capture first and converts through origin and scale.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer', description: 'Physical pixel x.' },
        y: { type: 'integer', description: 'Physical pixel y.' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Default left.' },
        count: { type: 'integer', description: '1 (default) or 2 to double-click.' },
      },
      required: ['x', 'y'],
      additionalProperties: false,
    },
  },
  {
    name: 'computer_type',
    description:
      'Type text into whatever window has focus. Unicode, so Chinese and accented characters work regardless of the keyboard layout. Click or focus the field first.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The text to type.' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'computer_key',
    description:
      'Press a key or a chord, e.g. "enter", "tab", "esc", "ctrl+s", "alt+tab", "ctrl+shift+esc". Goes to whichever window has focus.',
    inputSchema: {
      type: 'object',
      properties: { keys: { type: 'string', description: 'Key or "+"-joined chord.' } },
      required: ['keys'],
      additionalProperties: false,
    },
  },
  {
    name: 'computer_scroll',
    description: 'Scroll the focused window. Positive scrolls up, negative down; 120 is one notch.',
    inputSchema: {
      type: 'object',
      properties: { amount: { type: 'integer', description: 'Scroll distance, e.g. 120 or -360.' } },
      required: ['amount'],
      additionalProperties: false,
    },
  },
]

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function callComputer(op, payload) {
  return new Promise((resolve, reject) => {
    if (!PIPE || !TOKEN) {
      reject(new Error('VesPi desktop control is not configured (missing pipe or token)'))
      return
    }
    const body = JSON.stringify(payload ?? {})
    const req = http.request(
      {
        socketPath: PIPE,
        path: `/computer/${op}`,
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
            reject(new Error(`the desktop channel returned ${res.statusCode}`))
            return
          }
          try {
            const parsed = JSON.parse(text)
            if (parsed && parsed.ok) resolve(parsed.result)
            else reject(new Error((parsed && parsed.error) || 'the desktop operation failed'))
          } catch {
            reject(new Error('the desktop channel returned a malformed response'))
          }
        })
      }
    )
    // The shell already times out its own side; this is only a backstop against
    // a pipe that accepts a request and then goes quiet.
    req.setTimeout(90_000, () => {
      req.destroy(new Error('the desktop channel stopped responding'))
    })
    req.on('error', (error) => reject(new Error(`the desktop channel is unavailable: ${error.message}`)))
    req.end(body)
  })
}

/**
 * A screenshot comes back as an image plus the numbers needed to convert what the
 * model sees into a coordinate. Sending the image alone would leave it guessing
 * the offset, and on a window capture that guess is always wrong.
 */
function toolResult(result) {
  if (result && typeof result === 'object' && result.pngBase64) {
    const source = result.source && result.source.title ? `"${result.source.title}"` : 'the desktop'
    const text =
      `Screenshot of ${source}: ${result.width}x${result.height} pixels at scale ${result.scale}, ` +
      `top-left corner at screen ${result.origin.x},${result.origin.y}. ` +
      `Screen coordinate = origin + imagePixel x scale.`
    return {
      content: [
        { type: 'image', data: result.pngBase64, mimeType: 'image/png' },
        { type: 'text', text },
      ],
    }
  }
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? null, null, 2)
  return { content: [{ type: 'text', text }] }
}

function handleToolCall(params) {
  const name = String(params?.name ?? '')
  if (!name.startsWith('computer_')) throw new Error(`unknown tool: ${name}`)
  const op = name.slice('computer_'.length)
  const args = params?.arguments ?? {}
  // `screen` and `windows` take no arguments; everything else passes its own
  // through, and the shell rejects anything it does not recognise.
  if (op === 'screen' || op === 'windows') return callComputer(op, {})
  return callComputer(op, args)
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
        serverInfo: { name: 'vespi-computer', version: '1.0.0' },
        instructions: INSTRUCTIONS,
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
          content: [{ type: 'text', text: `desktop operation failed: ${error.message}` }],
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
