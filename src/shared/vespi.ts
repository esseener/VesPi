export const VESPI_PROFILE = 'vespi'
export const VESPI_RPC_MODE = 'rpc-ui'
export const VESPI_PROFILE_FLAG = '--profile'
export const VESPI_APP_ID = 'com.vespi.desktop'
export const VESPI_PRODUCT_NAME = 'VesPi'
export const VESPI_USER_DATA_ENV = 'VESPI_USER_DATA_DIR'
export const VESPI_WORKSPACE_ENV = 'VESPI_WORKSPACE'
export const VESPI_PRIVATE_OMP_REL = 'runtime/omp/omp.exe'

/**
 * Extension command the goal strip dispatches (implemented in
 * `resources/vespi-goal.ts`, which hardcodes the same string — the extension is
 * loaded by the kernel as a plain file and cannot import from src).
 *
 * Goal mode is kernel-owned and exposes no client-side entry point: the RPC
 * command table has no goal verb, the ExtensionAPI has none, and the `goal` tool
 * itself is only reachable by the model. Dispatching this command is therefore the
 * shell's way in — commands execute immediately even while a turn streams, and the
 * extension steers a hidden message at the model from there.
 */
export const VESPI_GOAL_CONTROL_COMMAND = 'vespi-goal'

/** The three goal-strip buttons, in the order they may be dispatched. */
export const VESPI_GOAL_CONTROL_OPS = ['resume', 'complete', 'drop'] as const

export type GoalControlOp = (typeof VESPI_GOAL_CONTROL_OPS)[number]

/**
 * Why a dispatch failed. `extension-missing` is the interesting one: without the
 * goal extension the command is unknown, and a bare prompt would fall through to
 * a real LLM turn — the strip must not claim success in that case.
 */
export type GoalControlFailure =
  | 'no-pi'
  | 'pi-not-running'
  | 'extension-missing'
  | 'dispatch-failed'
  | 'timeout'

export interface GoalControlResult {
  op: GoalControlOp
  ok: boolean
  dispatched?: boolean
  reason?: GoalControlFailure
}

export function isGoalControlOp(value: unknown): value is GoalControlOp {
  return typeof value === 'string' && (VESPI_GOAL_CONTROL_OPS as readonly string[]).includes(value)
}

/**
 * Session partition for the embedded browser panel's `<webview>`.
 *
 * Persistent so logins survive a restart, and deliberately separate from the
 * main window: pages opened here never see the app's cookies or storage (and
 * vice versa). The main process keys its `will-attach-webview` exemption off
 * exactly this value — the panel is the only guest allowed to load http(s)
 * URLs, everything else stays confined to local `file://` previews.
 */
export const VESPI_BROWSER_PARTITION = 'persist:vespi-browser'

/** True for a well-formed http(s) URL — the only schemes the browser panel may load. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function vespiProfileArgs(): string[] {
  return [VESPI_PROFILE_FLAG, VESPI_PROFILE]
}
