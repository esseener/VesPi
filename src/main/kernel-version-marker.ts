import { dirname, join } from 'path'

/**
 * Remembers which kernel version the binary on disk actually is.
 *
 * Why this exists: the only other way to learn the installed kernel's version is
 * to run it with `--version`, and that binary is a ~154 MB Bun build — 1.4 s
 * idle, more on a busy machine. The update check runs on launch and every 30
 * minutes, so that spawn was happening constantly; worse, when it timed out the
 * version came back empty, and an empty "current" version reads as
 * `updateAvailable: true`, so the banner advertised a kernel update that was not
 * there.
 *
 * A marker alone would be a liability — it goes stale the moment the binary is
 * replaced. So it only speaks for the exact file it was written for: the size and
 * mtime of the binary are recorded with it and checked on every read. Anything
 * else (replaced by an installer, hand-swapped, touched) invalidates it and the
 * caller falls back to probing.
 *
 * The filename is deliberately NOT `.version`: `scripts/update-omp.mjs` and the
 * release-consistency gate already use that name for plain-text packaging
 * metadata, and two formats under one name is a trap.
 */
export const INSTALLED_KERNEL_MARKER_NAME = '.installed-kernel.json'

export interface KernelBinaryStat {
  size: number
  mtimeMs: number
}

export function installedKernelMarkerPath(ompPath: string): string {
  return join(dirname(ompPath), INSTALLED_KERNEL_MARKER_NAME)
}

/**
 * The version recorded for this exact binary, or null when the marker is absent,
 * malformed, or describes a different file than the one on disk.
 */
export function readInstalledKernelVersion(markerText: string | null, stat: KernelBinaryStat | null): string | null {
  if (!markerText || !stat) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(markerText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const record = parsed as { version?: unknown; size?: unknown; mtimeMs?: unknown }
  if (typeof record.version !== 'string' || !record.version) return null
  if (typeof record.size !== 'number' || typeof record.mtimeMs !== 'number') return null
  // The binary is the source of truth; the marker only describes it.
  if (record.size !== stat.size || record.mtimeMs !== stat.mtimeMs) return null
  return record.version
}

export function formatInstalledKernelMarker(version: string, stat: KernelBinaryStat): string {
  return `${JSON.stringify({ version, size: stat.size, mtimeMs: stat.mtimeMs }, null, 2)}\n`
}
