export const VESPI_PROFILE = 'vespi'
export const VESPI_RPC_MODE = 'rpc-ui'
export const VESPI_PROFILE_FLAG = '--profile'
export const VESPI_APP_ID = 'com.vespi.desktop'
export const VESPI_PRODUCT_NAME = 'VesPi'
export const VESPI_USER_DATA_ENV = 'VESPI_USER_DATA_DIR'
export const VESPI_WORKSPACE_ENV = 'VESPI_WORKSPACE'
export const VESPI_PRIVATE_OMP_REL = 'runtime/omp/omp.exe'

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
