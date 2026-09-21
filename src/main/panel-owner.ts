/**
 * Which workspace's agent last reached for the embedded browser panel.
 *
 * The panel tools (`panel_open`, `panel_eval`, …) reach the main process over a
 * named pipe that carries nothing but the operation and its payload — there is
 * no workspace or session on it, and no way to add one: the pipe, its token and
 * the MCP entry that points at it are all single, global, per-launch things
 * shared by every live kernel. See `vespi-panel-mcp.mjs` and `panel-channel.ts`.
 *
 * The attribution therefore comes from the other side of the same moment: the
 * kernel emits `tool_execution_start` for every tool call, and VesPi receives it
 * through `workspaceManager.onPiManager(...)`, which is per workspace. A `panel_*`
 * tool call is therefore the workspace that is about to drive the panel, known
 * before the pipe request arrives.
 *
 * MCP tools are named by their server, so the wire name may be namespaced —
 * `mcp__vespi-panel__panel_open` and the like. Matching is therefore on the
 * bracketed operation rather than on a bare prefix.
 *
 * A miss is not a failure: `current()` returning null simply leaves the request
 * unattributed, and the shell falls back to showing the panel in the active
 * workspace, exactly as it did before this existed.
 */

/** The operations `vespi-panel-mcp.mjs` exposes, as `<server-prefix>panel_<op>`. */
const PANEL_TOOL_PATTERN =
  /(?:^|[^a-z0-9])panel_(?:open|state|reload|back|forward|eval|text|screenshot)(?![a-z0-9_])/i

export function isPanelToolName(name: string): boolean {
  return PANEL_TOOL_PATTERN.test(name)
}

export interface PanelOwnerTracker {
  /** Record that `workspaceId` just started a panel tool call. */
  note(workspaceId: string | null): void
  /** The workspace to attribute a panel request to, or null when unknown. */
  current(): string | null
}

/**
 * Panel operations are short, and each one starts its own tool call, so the
 * record only has to outlive a single request. The window exists to stop a
 * stale attribution from a long-finished turn being reused — not to give the
 * request time to arrive.
 */
export const PANEL_OWNER_TTL_MS = 30_000

export function createPanelOwnerTracker(
  ttlMs: number = PANEL_OWNER_TTL_MS,
  now: () => number = Date.now
): PanelOwnerTracker {
  let owner: { workspaceId: string; at: number } | null = null

  return {
    note(workspaceId) {
      owner = workspaceId ? { workspaceId, at: now() } : null
    },
    current() {
      if (!owner) return null
      if (now() - owner.at > ttlMs) {
        owner = null
        return null
      }
      return owner.workspaceId
    },
  }
}
