import type { ComputerSidecar } from './computer-sidecar'

/**
 * The desktop operations, expressed as policy over a request/response helper.
 *
 * Everything that makes desktop control *safe* lives here rather than in the
 * sidecar, because it is policy and policy belongs where the settings are:
 *
 * - **VesPi's own window is never a target.** The harness tells the model not to
 *   drive the application it is running in, and this is the enforcement: the user
 *   is using that window, and a synthetic click in it can lose their work.
 * - **An allow-list, when configured.** An empty list means "no restriction
 *   configured" — the feature itself is off by default and turning it on is the
 *   user's authorisation. A non-empty list is a hard boundary: any window whose
 *   process is not on it is refused, before anything is driven.
 * - **Bounds on everything.** Element lists, typed text, screenshot size. A model
 *   that asks for a 5000-row accessibility walk is not going to read it, and a
 *   screenshot bigger than the context window is worse than a smaller one.
 *
 * The sidecar methods are deliberately one step below these names: `windows`
 * wraps `list_windows`, `screen` wraps `screen_info`, and the rest pass through.
 */

export const COMPUTER_OPS = [
  'screen',
  'windows',
  'focus',
  'capture',
  'uitree',
  'invoke',
  'click',
  'type',
  'key',
  'scroll',
] as const

export type ComputerOp = (typeof COMPUTER_OPS)[number]

export function isComputerOp(value: string): value is ComputerOp {
  return (COMPUTER_OPS as readonly string[]).includes(value)
}

/** Operations that move the user's mouse or keyboard. */
export const INPUT_OPS: readonly ComputerOp[] = ['click', 'type', 'key', 'scroll']

/** Element lists get very long; nobody reads the five-thousandth row. */
export const MAX_TREE_ELEMENTS = 800
export const DEFAULT_TREE_ELEMENTS = 300

/** Long edge of a screenshot handed to the model, in physical pixels. */
export const MAX_CAPTURE_EDGE = 1568
export const DEFAULT_CAPTURE_EDGE = 1280

/** One `type` call is a form field, not a document. */
export const MAX_TYPE_CHARS = 8_000

export interface ComputerOpsDeps {
  call: ComputerSidecar['call']
  /** Process names the model may drive, e.g. `["notepad.exe"]`. Empty = unrestricted. */
  allowedApps: () => string[]
  /** VesPi's own executable name, which is never a valid target. */
  selfProcess: string
  /** Timeout for the slow methods (screenshots, accessibility walks). */
  slowTimeoutMs: number
}

/** One row of `list_windows`, as the sidecar reports it. */
interface WindowRow {
  id: number
  handle: number
  title: string
  process: string
  pid: number
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
  focused: boolean
}

interface ScreenInfo {
  width: number
  height: number
  desktop: { x: number; y: number; width: number; height: number; monitors: number }
  cursor: { x: number; y: number } | null
}

export function createComputerOps(deps: ComputerOpsDeps): (op: string, payload: Record<string, unknown>) => Promise<unknown> {
  const self = deps.selfProcess.toLowerCase()

  function allowList(): string[] {
    return deps.allowedApps()
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.length > 0)
  }

  async function windows(): Promise<WindowRow[]> {
    const result = (await deps.call('list_windows')) as { windows: WindowRow[] }
    return Array.isArray(result?.windows) ? result.windows : []
  }

  /**
   * Refuse to drive a process that is out of bounds. Called before anything with
   * a side effect, including the input ops, which act on whatever holds focus.
   */
  function assertAllowed(process: string | undefined, label: string): void {
    const name = (process ?? '').toLowerCase()
    if (name && name === self) {
      throw new Error(
        `${label} is VesPi itself — the user is working in that window. Drive the application they asked about instead.`
      )
    }
    const allowed = allowList()
    if (allowed.length === 0) return
    if (!name) {
      throw new Error(`${label} could not be identified, and only these applications are allowed: ${allowed.join(', ')}`)
    }
    if (!allowed.includes(name)) {
      throw new Error(`${label} is ${name}, which is not on the allowed application list: ${allowed.join(', ')}`)
    }
  }

  /** The window a request names, resolved through the sidecar's own view of it. */
  async function targetWindow(payload: Record<string, unknown>): Promise<WindowRow> {
    const handle = typeof payload.handle === 'number' ? payload.handle : null
    const index = typeof payload.window === 'number' ? payload.window : null
    const rows = await windows()

    const row =
      handle !== null
        ? rows.find((entry) => entry.handle === handle)
        : index !== null
          ? rows[index]
          : undefined

    if (!row) {
      throw new Error(
        handle !== null
          ? `no window with handle ${handle} — call computer_windows again`
          : index !== null
            ? `no window at index ${index} — call computer_windows again`
            : 'a window is required: pass the handle or the index from computer_windows'
      )
    }
    assertAllowed(row.process, `"${row.title}" (${row.process})`)
    return row
  }

  /** Input ops have no window argument: they reach whoever holds focus. */
  async function assertFocusAllowed(): Promise<WindowRow | null> {
    const rows = await windows()
    const focused = rows.find((row) => row.focused) ?? null
    if (focused) assertAllowed(focused.process, `the focused window "${focused.title}" (${focused.process})`)
    return focused
  }

  async function assertOnScreen(x: number, y: number): Promise<void> {
    const info = (await deps.call('screen_info')) as ScreenInfo
    const desktop = info?.desktop
    if (!desktop) return
    const inside =
      x >= desktop.x &&
      y >= desktop.y &&
      x < desktop.x + desktop.width &&
      y < desktop.y + desktop.height
    if (inside) return
    throw new Error(
      `(${x}, ${y}) is outside the desktop, which spans ${desktop.x},${desktop.y} to ${desktop.x + desktop.width},${desktop.y + desktop.height}` +
        (desktop.monitors > 1 ? ` across ${desktop.monitors} monitors` : '')
    )
  }

  function requiredNumber(payload: Record<string, unknown>, key: string): number {
    const value = payload[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${key} is required and must be a number`)
    }
    return value
  }

  function requiredString(payload: Record<string, unknown>, key: string): string {
    const value = payload[key]
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${key} is required`)
    }
    return value
  }

  function cappedNumber(payload: Record<string, unknown>, key: string, fallback: number, max: number): number {
    const value = payload[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    return Math.max(1, Math.min(Math.floor(value), max))
  }

  return async function run(op: string, payload: Record<string, unknown>): Promise<unknown> {
    if (!isComputerOp(op)) {
      throw new Error(`unknown operation: ${op}`)
    }

    switch (op) {
      case 'screen':
        return deps.call('screen_info')

      case 'windows': {
        // Marked rather than hidden: the model should be able to see that the
        // window exists and understand why it will not be allowed to touch it.
        const rows = await windows()
        const annotated = rows.map((row) =>
          (row.process ?? '').toLowerCase() === self
            ? { ...row, actionable: false, note: 'this is VesPi itself, which must not be driven' }
            : { ...row, actionable: true }
        )
        return {
          windows: annotated,
          count: annotated.length,
          allowedApps: allowList(),
          hint: 'pass the handle (preferred, it survives the list changing) or the index to computer_capture / computer_uitree / computer_focus',
        }
      }

      case 'focus': {
        const row = await targetWindow(payload)
        return deps.call('focus_window', { handle: row.handle })
      }

      case 'capture': {
        // No target means the whole desktop: a legitimate first move when the
        // model has been asked to look at the screen and does not yet know which
        // window matters.
        const hasTarget = typeof payload.handle === 'number' || typeof payload.window === 'number'
        const target = hasTarget ? await targetWindow(payload) : null
        return deps.call(
          'capture',
          {
            max: cappedNumber(payload, 'max', DEFAULT_CAPTURE_EDGE, MAX_CAPTURE_EDGE),
            ...(target ? { handle: target.handle } : {}),
          },
          deps.slowTimeoutMs
        )
      }

      case 'uitree': {
        const row = await targetWindow(payload)
        return deps.call(
          'uitree',
          { handle: row.handle, max: cappedNumber(payload, 'max', DEFAULT_TREE_ELEMENTS, MAX_TREE_ELEMENTS) },
          deps.slowTimeoutMs
        )
      }

      case 'invoke': {
        const row = await targetWindow(payload)
        const element = requiredNumber(payload, 'element')
        return deps.call('invoke_element', { handle: row.handle, element }, deps.slowTimeoutMs)
      }

      case 'click': {
        await assertFocusAllowed()
        const x = requiredNumber(payload, 'x')
        const y = requiredNumber(payload, 'y')
        await assertOnScreen(x, y)
        return deps.call('click', {
          x: Math.round(x),
          y: Math.round(y),
          button: typeof payload.button === 'string' ? payload.button : 'left',
          count: cappedNumber(payload, 'count', 1, 3),
        })
      }

      case 'type': {
        await assertFocusAllowed()
        const text = requiredString(payload, 'text')
        if (text.length > MAX_TYPE_CHARS) {
          throw new Error(`text is too long (${text.length} characters, limit ${MAX_TYPE_CHARS})`)
        }
        return deps.call('type', { text })
      }

      case 'key': {
        await assertFocusAllowed()
        return deps.call('key', { keys: requiredString(payload, 'keys') })
      }

      case 'scroll': {
        await assertFocusAllowed()
        return deps.call('scroll', { amount: requiredNumber(payload, 'amount') })
      }
    }
  }
}
