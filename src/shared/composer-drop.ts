/**
 * Which dropped paths the composer should attach, if any.
 *
 * The window has a folder drop of its own: dropping a directory anywhere opens
 * it as a workspace (see `hooks/use-folder-drop.ts`). That hook ignores plain
 * files on purpose so attachment drops could coexist, and this is the other
 * half of that contract — the composer claims file drops and hands directory
 * drops back.
 *
 * The directory check has to happen here, in `drop`: `webkitGetAsEntry()`
 * returns null during dragenter/dragover, so the two handlers cannot negotiate
 * before the mouse is released.
 */
/** The slice of DataTransfer this helper reads — keeps the unit tests honest. */
export interface DropItem {
  kind?: string
  webkitGetAsEntry?: () => { isDirectory?: boolean } | null
}

export interface DropPayload {
  items?: ArrayLike<DropItem>
  files?: ArrayLike<unknown>
}

export function attachableDropPaths(
  dataTransfer: DropPayload | null | undefined,
  pathForFile: (file: unknown) => string
): string[] {
  if (!dataTransfer) return []

  const items = Array.from(dataTransfer.items ?? [])

  // A folder in the payload is the workspace opener's business, not ours — even
  // when files ride along with it.
  for (const item of items) {
    if (item?.kind !== 'file') continue
    let entry: { isDirectory?: boolean } | null = null
    try {
      entry = item.webkitGetAsEntry?.() ?? null
    } catch {
      // A throwing entry probe must not swallow the drop; treat it as a file.
    }
    if (entry?.isDirectory === true) return []
  }

  const files = Array.from(dataTransfer.files ?? [])
  if (files.length === 0) return []

  const paths: string[] = []
  for (const file of files) {
    const path = pathForFile(file)
    if (typeof path === 'string' && path.length > 0) paths.push(path)
  }
  return paths
}
