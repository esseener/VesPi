import { VESPI_BROWSER_PARTITION, isHttpUrl } from '../shared/vespi'

/**
 * Whether a `<webview>` guest may attach at all.
 *
 * Two kinds of guest exist in this app, with opposite network needs:
 *
 *   • the embedded browser panel (`VESPI_BROWSER_PARTITION`) — a real web
 *     client, so it may load http(s) and nothing else. `file://` is refused so
 *     the panel can never be aimed at the local disk.
 *   • the file preview — local content only. Everything that is not `file://`
 *     is refused, which is what keeps a malicious workspace file from reaching
 *     the network through a preview.
 *
 * Kept as a pure function so the policy is unit-testable and cannot silently
 * drift from the comment above. It only decides *attachment*; the caller still
 * strips preload/Node privileges and sets the sandbox flags first, and those
 * assignments win over whatever the tag requested.
 */
export function isWebviewAttachAllowed(partition: string | undefined, src: string): boolean {
  if (partition === VESPI_BROWSER_PARTITION) return isHttpUrl(src)
  return src.startsWith('file://')
}
