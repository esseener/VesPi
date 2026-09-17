import type { AgentBrowserStatus } from './browser-cdp'

/**
 * When the agent's own browser is brought up.
 *
 * It used to be brought up at every app start, before the window existed: a
 * blank Chromium window appeared alongside VesPi whether or not anything was
 * ever going to browse. The endpoint only has to exist before the moment the
 * kernel *uses* it, so this defers the launch to the first sign that the agent
 * really wants a browser, and keeps the kernel away from a dead port in the
 * meantime.
 *
 * Why "away from a dead port" matters: OMP's browser tool resolves its target
 * per call and, when `browser.cdpUrl` is set, waits 5 s for that endpoint and
 * then throws — a configured-but-dead endpoint is a hard failure, not a quiet
 * fall back to a browser of its own. With the overlay withdrawn, the kernel
 * launches its own headless browser instead and keeps working. So publishing
 * the endpoint and bringing the browser up are one decision, made in one place.
 *
 * Policy only, with the browser machinery injected: testable without launching
 * anything, the same reason installer-handoff.ts exists.
 */

export interface AgentBrowserLifecycleDeps {
  /** User setting: may the agent drive a browser at all? */
  enabled: boolean
  /** Endpoint VesPi reserves for it; null when the feature is off. */
  port: number | null
  /** Whether something already answers on the endpoint. */
  isUp: () => Promise<boolean>
  /** Bring it up (reuses a live one) and publish it to the kernel. */
  start: () => Promise<AgentBrowserStatus>
  /** Take the endpoint away: overlay + tool wiring, so nothing points at it. */
  withdraw: () => void
  log: (message: string, detail?: unknown) => void
}

/** Which of the two moments asked for a browser — only used in the log. */
export type AgentBrowserReason = 'startup' | 'browser-tool'

export interface AgentBrowserLifecycle {
  /**
   * Startup: adopt an endpoint that is already answering (a browser left from a
   * previous run is still there, and it is free to keep using it), otherwise
   * make sure nothing points at a port nobody listens on. Never launches.
   */
  sync: (reason: AgentBrowserReason) => Promise<void>
  /**
   * The agent wants a browser: bring it up if it is not already answering.
   * Serialized, so a burst of tool calls starts at most one browser.
   */
  ensure: (reason: AgentBrowserReason) => Promise<void>
}

export function createAgentBrowserLifecycle(deps: AgentBrowserLifecycleDeps): AgentBrowserLifecycle {
  let inFlight: Promise<void> | null = null

  const available = (): boolean => deps.enabled && deps.port !== null

  async function sync(reason: AgentBrowserReason): Promise<void> {
    if (!available()) {
      deps.withdraw()
      return
    }
    if (await deps.isUp()) {
      // Already running (typically left over from the previous run): keep using
      // it, and republish, since the overlay is rewritten per launch.
      const status = await deps.start()
      deps.log(`Agent browser ${status} on 127.0.0.1:${deps.port} (${reason})`)
      return
    }
    deps.withdraw()
    deps.log(
      `No agent browser on 127.0.0.1:${deps.port} yet (${reason}); the kernel gets no endpoint and will launch its own if the model browses`
    )
  }

  async function ensure(reason: AgentBrowserReason): Promise<void> {
    if (!available()) return
    if (inFlight) {
      await inFlight
      return
    }
    inFlight = (async (): Promise<void> => {
      const status = await deps.start()
      if (status === 'unavailable') {
        // No Chromium-family browser installed, or it refused to start. Hand the
        // kernel nothing rather than an endpoint that will time out.
        deps.withdraw()
        deps.log('No browser available for the agent; the kernel falls back to its own headless browser')
        return
      }
      deps.log(`Agent browser ${status} on 127.0.0.1:${deps.port} (${reason})`)
    })().finally(() => {
      inFlight = null
    })
    await inFlight
  }

  return { sync, ensure }
}

/**
 * Whether a tool call is one the agent's browser exists to serve.
 *
 * Matches the kernel's own `browser` prelude, the vendored Playwright tools
 * (`browser_navigate`, `browser_click`, …), and the same names when they arrive
 * namespaced by an MCP server (`mcp__playwright__browser_snapshot`).
 */
export function isBrowserToolName(name: string): boolean {
  return name.toLowerCase().includes('browser')
}
