import { isHttpUrl } from '../shared/vespi'
import type { PanelRequest } from './panel-channel'

/**
 * The panel operations, expressed against a minimal interface rather than a
 * concrete Electron `WebContents`. That keeps every rule here — which URLs may
 * be opened, how big a result may get, what happens when the panel is not open —
 * unit-testable without an Electron runtime.
 *
 * The guest is the `<webview>` inside the renderer; VesPi receives it in
 * `did-attach-webview`, which is why VesPi can drive the panel at all while the
 * kernel's CDP-based browser tools cannot.
 */
export interface PanelGuestLike {
  isDestroyed(): boolean
  getURL(): string
  getTitle(): string
  isLoading(): boolean
  canGoBack(): boolean
  canGoForward(): boolean
  loadURL(url: string): Promise<unknown>
  reload(): void
  goBack(): void
  goForward(): void
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  capturePage(): Promise<{ isEmpty(): boolean; toPNG(): Buffer }>
}

/** Visible text is capped: pages like a search result are enormous. */
export const PANEL_TEXT_MAX_CHARS = 60_000

/** Guards against an unbounded expression being relayed through the pipe. */
export const PANEL_EXPRESSION_MAX_CHARS = 20_000

/** A screenshot larger than this is a mistake, not a result. */
export const PANEL_SCREENSHOT_MAX_BYTES = 8_000_000

/**
 * Wrap a model-supplied expression so the result survives the JSON trip back
 * over the pipe: `await` it, drop to the JSON projection, and fall back to
 * `String()` for values that cannot be serialized (DOM nodes, functions).
 */
export function panelEvalWrapper(expression: string): string {
  return [
    '(async () => {',
    `  const value = await (\n${expression}\n  );`,
    '  if (value === undefined) return null;',
    '  try { return JSON.parse(JSON.stringify(value)); }',
    '  catch { return String(value); }',
    '})()',
  ].join('\n')
}

/** Operations that act on the page, and so should be brought into view. */
const ACTIVATING_OPS = new Set(['reload', 'back', 'forward', 'eval'])

export interface PanelOpsDeps {
  /** The panel's guest webContents, or null while the panel is not attached. */
  getGuest: () => PanelGuestLike | null
  /**
   * Ask the shell to bring the panel into view, mounting it at `url` when given.
   *
   * Navigation deliberately goes through the shell rather than `guest.loadURL`:
   * the panel's `<webview>` only exists once it has a URL, and the address bar
   * is driven by that same state. Driving the guest directly would leave the
   * bar showing something other than what the user is looking at.
   *
   * Reads never call this — otherwise a model polling the page would keep
   * yanking the user away from whatever they were reading.
   */
  requestPanel: (url?: string) => void
}

function requireGuest(deps: PanelOpsDeps): PanelGuestLike {
  const guest = deps.getGuest()
  if (!guest || guest.isDestroyed()) {
    throw new Error('the browser panel is not open — call panel_open first')
  }
  return guest
}

export function createPanelOps(deps: PanelOpsDeps): (request: PanelRequest) => Promise<unknown> {
  return async (request) => {
    const { op, payload } = request

    if (op === 'open') {
      const url = String(payload.url ?? '').trim()
      if (!url) throw new Error('url is required')
      // The panel is a real web client and is deliberately limited to the web:
      // `file://` would point it at the local disk. Checked here, before the
      // shell is asked to do anything.
      if (!isHttpUrl(url)) throw new Error('only http(s) URLs can be opened in the panel')
      deps.requestPanel(url)
      // Reported as requested, not loaded: the page has not arrived yet, and
      // claiming otherwise would be the kind of quiet lie this codebase avoids.
      return { url, requested: true }
    }

    if (ACTIVATING_OPS.has(op)) deps.requestPanel()
    const guest = requireGuest(deps)

    switch (op) {
      case 'state':
        return {
          url: guest.getURL(),
          title: guest.getTitle(),
          loading: guest.isLoading(),
          canGoBack: guest.canGoBack(),
          canGoForward: guest.canGoForward(),
        }

      case 'reload':
        guest.reload()
        return { reloading: true, url: guest.getURL() }

      case 'back': {
        if (!guest.canGoBack()) return { moved: false, url: guest.getURL() }
        guest.goBack()
        return { moved: true }
      }

      case 'forward': {
        if (!guest.canGoForward()) return { moved: false, url: guest.getURL() }
        guest.goForward()
        return { moved: true }
      }

      case 'eval': {
        const expression = String(payload.expression ?? '').trim()
        if (!expression) throw new Error('expression is required')
        if (expression.length > PANEL_EXPRESSION_MAX_CHARS) {
          throw new Error(`expression is too long (limit ${PANEL_EXPRESSION_MAX_CHARS} characters)`)
        }
        // `userGesture` so synthetic clicks look like the user's, which some
        // sites require before they respond.
        return { value: await guest.executeJavaScript(panelEvalWrapper(expression), true) }
      }

      case 'text': {
        const raw = await guest.executeJavaScript('document.body ? document.body.innerText : ""')
        const text = typeof raw === 'string' ? raw : String(raw ?? '')
        if (text.length <= PANEL_TEXT_MAX_CHARS) return { text }
        return { text: text.slice(0, PANEL_TEXT_MAX_CHARS), truncated: true, totalChars: text.length }
      }

      case 'screenshot': {
        const image = await guest.capturePage()
        if (image.isEmpty()) throw new Error('the panel is not showing anything to capture')
        const png = image.toPNG()
        if (png.length > PANEL_SCREENSHOT_MAX_BYTES) {
          throw new Error(`screenshot is too large (${png.length} bytes)`)
        }
        return { imagePngBase64: png.toString('base64'), bytes: png.length }
      }

      default:
        // `open` returned above; anything else is a caller mistake.
        throw new Error(`unknown operation: ${op}`)
    }
  }
}
