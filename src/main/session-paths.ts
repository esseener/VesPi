/**
 * Helpers for mapping between real project paths and the directory names Pi
 * uses under `~/.pi/agent/sessions`.
 *
 * Pi encodes a project path into a session directory name by replacing path
 * separators — and, on Windows, the drive-letter colon — with `-`, then
 * wrapping the result in `--`:
 *
 *   POSIX    /home/alice                    -> --home-alice--
 *   Windows  C:\Users\UPN\documents\workday -> --C--Users-UPN-documents-workday--
 *
 * Decoding is inherently lossy (real `-` characters are indistinguishable from
 * separators), so callers should prefer matching against known workspace paths
 * and fall back to `desanitizeSessionDir` only for display.
 */

import { isPathCaseInsensitive } from '../shared/path-compare'

/** Extension of a Pi session file. */
export const JSONL_EXTENSION = '.jsonl'
/** Encode a real filesystem path the same way Pi names its session directory. */
export function sanitizePath(p: string): string {
  // Drop a single leading separator so POSIX "/home/x" -> "--home-x--".
  // Windows paths start with a drive letter, so nothing is stripped there.
  const body = p.replace(/^[\\/]/, '').replace(/[\\/:]/g, '-')
  return `--${body}--`
}

/**
 * Every directory name OMP may use for a project path.
 *
 * OMP does not use one encoding: paths under the user's home directory are
 * stored relative to home (leading separator kept, no `--` wrap — e.g.
 * `C:\Users\me\Downloads\proj` -> `-Downloads-proj`), while other paths use
 * the full drive-qualified wrapped form (`D:\proj` -> `--D--proj--`). Matching
 * a session directory back to a workspace must try both, or home-relative
 * projects silently lose their workspace label and vanish from the sidebar's
 * per-project filter.
 */
export function sessionDirCandidates(
  p: string,
  home: string,
  caseInsensitive: boolean = isPathCaseInsensitive(),
): string[] {
  const out = [sanitizePath(p)]
  const stripTrailing = (s: string) => s.replace(/[\\/]+$/, '')
  const hp = stripTrailing(home)
  const pp = stripTrailing(p)
  const underHome =
    pp.length > hp.length + 1 &&
    /[\\/]/.test(pp[hp.length]) &&
    (caseInsensitive ? pp.toLowerCase().startsWith(hp.toLowerCase()) : pp.startsWith(hp))
  if (underHome) {
    out.push(pp.slice(hp.length).replace(/[\\/]/g, '-'))
  }
  return out
}

/**
 * The Pi session directory name for `dir`, relative to `sessionsRoot`.
 * Strips the root prefix and any leading separator of either kind, and
 * normalizes backslashes so the result compares equal across platforms.
 */
export function sessionDirName(dir: string, sessionsRoot: string): string {
  const rel = dir.startsWith(sessionsRoot) ? dir.slice(sessionsRoot.length) : dir
  return rel.replace(/^[\\/]+/, '').replace(/\\/g, '/')
}

/**
 * A session's own artifact directory, named after the session file rather than
 * after a project path: `<ISO timestamp>_<uuid>`.
 *
 * OMP writes each subagent's transcript into one of these beside the session
 * store root. They are not projects, and their contents are not user sessions.
 * Left unguarded, the index listed `SecurityReview.jsonl` as a chat, and
 * opening it spawned a real agent against a subagent's transcript.
 */
const SESSION_ARTIFACT_DIR_RE = /^\d{4}-\d{2}-\d{2}T[\d-]+Z_[0-9a-fA-F-]{36}$/

export function isSessionArtifactDir(dirName: string): boolean {
  return SESSION_ARTIFACT_DIR_RE.test(dirName)
}

/**
 * Best-effort (lossy) reversal of `sanitizePath`.
 * Returns the directory name unchanged if it isn't a Pi-sanitized name.
 *
 * Reconstructs a Windows path when the name carries the drive-letter
 * signature ("C:\" encodes to "C--", i.e. a single-letter segment followed by
 * an empty one), otherwise a POSIX path. Keeping decoded paths native means
 * they display correctly and stay valid when reused (e.g. as a workspace path).
 */
export function desanitizeSessionDir(dirName: string, home?: string): string {
  if (!dirName.startsWith('--') || !dirName.endsWith('--')) {
    // Home-relative OMP name (`-Downloads-proj`): decode against the real home
    // directory when the caller provides one. Lossy like every other decode —
    // a `-` may be a literal — but far better than showing the raw slug.
    if (home && dirName.startsWith('-') && !dirName.startsWith('--')) {
      const rel = dirName.replace(/-/g, home.includes('\\') ? '\\' : '/')
      return home.replace(/[\\/]+$/, '') + rel
    }
    return dirName
  }
  const inner = dirName.slice(2, -2)
  const rawSegments = inner.split('-')

  // Windows: a leading "<letter>--" came from "<letter>:\".
  if (rawSegments.length >= 2 && /^[A-Za-z]$/.test(rawSegments[0]) && rawSegments[1] === '') {
    const drive = rawSegments[0].toUpperCase()
    const rest = rawSegments.slice(2).filter(Boolean)
    return rest.length ? `${drive}:\\${rest.join('\\')}` : `${drive}:\\`
  }

  // POSIX: drop empty segments and rejoin with '/'.
  const segments = rawSegments.filter(Boolean)
  return '/' + segments.join('/')
}

/** Separator-agnostic basename; handles both `/` and `\` and trailing separators. */
export function projectNameFromPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : p
}

// Single implementation lives in shared so main + renderer cannot drift.
export { pathsEqual, pathGroupKey } from '../shared/path-compare'
