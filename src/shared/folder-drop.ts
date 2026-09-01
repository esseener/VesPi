/**
 * Pure helpers for opening a dragged folder as a workspace.
 * Kept free of Electron/DOM globals so main, renderer, and tests share one path.
 *
 * Written for Chromium/Electron only: DataTransfer.types is a frozen string
 * array with a "Files" entry for OS file drags.
 */

/** Minimal shape of DataTransfer used by the drop helpers (no full DOM types). */
export interface FileDragTransfer {
  types: ArrayLike<string>
  items?: ArrayLike<FileDragItem> | null
}

export interface FileDragItem {
  kind: string
  type?: string
  webkitGetAsEntry?: () => { isDirectory: boolean; isFile: boolean } | null
  getAsFile: () => File | null
}

/** Display name for a workspace created from a folder path. */
export function workspaceNameFromFolderPath(folderPath: string): string {
  const name = folderPath.split(/[\\/]/).filter(Boolean).pop()
  return name && name.length > 0 ? name : folderPath
}

/**
 * Whether a DataTransfer looks like an OS file/folder drag (not internal
 * text/HTML/image drags). Dragging the in-app logo must not open a workspace.
 */
export function isFileDrag(dataTransfer: FileDragTransfer | null | undefined): boolean {
  if (!dataTransfer?.types) return false
  const types = Array.from(dataTransfer.types)
  if (!types.includes('Files')) return false
  if (types.some((type) => type === 'text/uri-list' || type === 'text/html' || type.startsWith('image/'))) {
    return false
  }
  const items = dataTransfer.items
  if (items && items.length > 0) {
    let sawFile = false
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind !== 'file') continue
      sawFile = true
      if (typeof item.type === 'string' && item.type.startsWith('image/')) return false
      const file = item.getAsFile()
      if (file && typeof file.type === 'string' && file.type.startsWith('image/')) return false
      if (file && /\.(svg|png|jpe?g|gif|webp|ico)$/i.test(file.name)) return false
    }
    if (!sawFile) return false
  }
  return true
}

/**
 * Absolute paths that could be the dropped folder, in confidence order:
 * confirmed directory entries first, then items whose kind is unknown because
 * webkitGetAsEntry returned null (some drag sources). Confirmed plain files
 * are excluded, and an unknown never shadows a confirmed folder behind it.
 * The caller probes each candidate (main-side pathKind) and opens the first
 * directory.
 */
export function droppedFolderCandidates(
  dataTransfer: FileDragTransfer,
  getPathForFile: (file: File) => string
): string[] {
  const items = dataTransfer.items
  if (!items || items.length === 0) return []

  const directories: string[] = []
  const unknowns: string[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind !== 'file') continue
    if (typeof item.type === 'string' && item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file && typeof file.type === 'string' && file.type.startsWith('image/')) continue
    if (file && /\.(svg|png|jpe?g|gif|webp|ico)$/i.test(file.name)) continue

    const entry =
      typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
    if (entry && !entry.isDirectory) continue

    if (!file) continue
    const p = getPathForFile(file)
    if (!p) continue
    ;(entry ? directories : unknowns).push(p)
  }

  return [...directories, ...unknowns]
}
