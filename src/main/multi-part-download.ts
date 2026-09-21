import { createReadStream, createWriteStream, existsSync, statSync, unlinkSync, type WriteStream } from 'node:fs'
import { finished } from 'node:stream/promises'

/**
 * Multi-part downloader for the two big artefacts VesPi fetches from GitHub — the
 * ~210 MB installer and the ~200 MB kernel.
 *
 * Why it exists: a single connection to GitHub's release CDN (the asset 302s to
 * `release-assets.githubusercontent.com`) is commonly throttled well under
 * 400 KB/s, which puts a 210 MB download past the old whole-download timeout and
 * failed the update with "timed out" on links that looked perfectly healthy.
 * Fetching several byte ranges in parallel adds those throttled connections up,
 * and keeping the ranges on disk between attempts means a slow link resumes
 * instead of starting over.
 *
 * Two timeouts, both honest about what they measure:
 *  - `inactivityTimeoutMs` — no bytes for this long on a connection, give up.
 *    This, not a deadline, is what a slow-but-alive link should be judged by.
 *  - `overallTimeoutMs` — a generous backstop so nothing hangs forever.
 *
 * Transport is injected (`PartSource`) so the part planning, resume, progress
 * aggregation and merge can be tested against a real local HTTP server without
 * Electron; `ipc/update-handlers.ts` supplies the `net.request`-based source.
 */

export interface DownloadPart {
  index: number
  /** First byte of the range, inclusive. */
  start: number
  /** Last byte of the range, inclusive. */
  end: number
}

/** Byte ranges for a download of `total` bytes across `partCount` connections. */
export function planParts(total: number, partCount: number): DownloadPart[] {
  const count = Math.max(1, Math.min(partCount, total))
  const size = Math.ceil(total / count)
  const parts: DownloadPart[] = []
  for (let index = 0, start = 0; start < total; index++, start += size) {
    parts.push({ index, start, end: Math.min(start + size, total) - 1 })
  }
  return parts
}

/** Each part gets its own file so a finished range can be recognised after a restart. */
export function partPath(dest: string, index: number): string {
  return `${dest}.part${index}`
}

/**
 * Drop a download's part files.
 *
 * In the success path a leftover file only costs disk space. In the fallback path
 * it is worse than that: the next attempt would read it as a complete range and
 * merge whatever it holds into the result.
 */
function removePartFiles(dest: string, parts: DownloadPart[]): void {
  for (const part of parts) {
    try {
      unlinkSync(partPath(dest, part.index))
    } catch {
      // Missing or locked — nothing a later attempt cannot overwrite.
    }
  }
}

/**
 * Thrown when a ranged request comes back with the whole file instead. The
 * downloader answers it by falling back to a single connection — six ranges each
 * writing 210 MB is the failure this exists to prevent.
 */
export const RANGE_UNSUPPORTED = 'byte ranges are not honoured by this endpoint'

export function isRangeUnsupported(err: unknown): boolean {
  return err instanceof Error && err.message.includes(RANGE_UNSUPPORTED)
}

/**
 * How many bytes of a part are already on disk, clamped to the part's length.
 * A part file longer than its range (a stale file from an older release) counts
 * as zero so it is refetched rather than trusted.
 */
export function partBytesOnDisk(dest: string, part: DownloadPart): number {
  const path = partPath(dest, part.index)
  if (!existsSync(path)) return 0
  const length = part.end - part.start + 1
  try {
    const size = statSync(path).size
    return size > length ? 0 : size
  } catch {
    return 0
  }
}

export interface PartSource {
  /** Total size and whether byte ranges are honoured. `total: null` = unknown. */
  probe: () => Promise<{ total: number | null; acceptsRanges: boolean }>
  /**
   * Fetch an inclusive byte range, handing chunks to `onChunk`.
   *
   * `requireRange` separates the two uses: a part fetch must get 206 back (a 200
   * means the whole file arrived and the caller falls back), while the
   * single-connection path asks for 0..total-1 and expects exactly that 200.
   */
  get: (
    start: number,
    end: number,
    onChunk: (chunk: Buffer) => void,
    signal: AbortSignal,
    options?: { requireRange?: boolean }
  ) => Promise<void>
}

export interface DownloadOptions {
  source: PartSource
  dest: string
  onProgress?: (received: number, total: number) => void
  /** Parallel connections for a ranged download. Ignored for small files. */
  partCount?: number
  /** Below this size a ranged download is not worth the extra connections. */
  minPartBytes?: number
  inactivityTimeoutMs?: number
  overallTimeoutMs?: number
  log?: (message: string) => void
}

const DEFAULT_PART_COUNT = 6
const DEFAULT_MIN_PART_BYTES = 8 * 1024 * 1024
const DEFAULT_INACTIVITY_TIMEOUT_MS = 45_000
const DEFAULT_OVERALL_TIMEOUT_MS = 60 * 60_000
/** Progress is reported at most this often; per-chunk reporting flooded the renderer. */
const PROGRESS_INTERVAL_MS = 200

/**
 * Download `url` to `dest`, resuming whatever is already on disk. Throws with a
 * message that says what actually happened (no bytes for N s vs. the backstop).
 */
export async function downloadFile(options: DownloadOptions): Promise<{ bytes: number; connections: number }> {
  const {
    source,
    dest,
    onProgress,
    partCount = DEFAULT_PART_COUNT,
    minPartBytes = DEFAULT_MIN_PART_BYTES,
    inactivityTimeoutMs = DEFAULT_INACTIVITY_TIMEOUT_MS,
    overallTimeoutMs = DEFAULT_OVERALL_TIMEOUT_MS,
    log = () => {},
  } = options

  const probe = await source.probe()
  const total = probe.total
  const useParts = probe.acceptsRanges && total !== null && total >= minPartBytes

  const controller = new AbortController()
  let lastReport = 0
  let received = 0
  const report = (force: boolean): void => {
    if (!onProgress || total === null) return
    const now = Date.now()
    if (!force && now - lastReport < PROGRESS_INTERVAL_MS) return
    lastReport = now
    onProgress(received, total)
  }
  const bump = (chunkBytes: number): void => {
    received += chunkBytes
    report(false)
  }

  const overall = setTimeout(() => controller.abort(), overallTimeoutMs)

  try {
    if (!useParts || total === null) {
      log('single connection (ranges unsupported or file small)')
      await fetchSingle(source, dest, total, bump, controller.signal, inactivityTimeoutMs)
      report(true)
      return { bytes: received, connections: 1 }
    }

    const parts = planParts(total, partCount)
    const resumable = parts.filter((part) => partBytesOnDisk(dest, part) === part.end - part.start + 1)
    // Already-downloaded ranges count toward progress from the first byte.
    received = resumable.reduce((sum, part) => sum + (part.end - part.start + 1), 0)
    report(true)
    if (resumable.length > 0) {
      log(`resuming: ${resumable.length}/${parts.length} ranges already complete`)
    }

    // Every connection is given the chance to settle before this moves on, and
    // each rejection is caught here rather than by `Promise.all`. Two reasons: a
    // failure has to abort the *other* five connections (otherwise they keep
    // writing into a download the caller has already been told failed, racing the
    // retry it is about to start), and their rejections would otherwise surface as
    // unhandled, since `Promise.all` only ever reports the first one.
    const failures: unknown[] = []
    await Promise.all(
      parts.map((part) =>
        fetchPart(source, dest, part, bump, controller.signal, inactivityTimeoutMs).catch((err: unknown) => {
          failures.push(err)
          controller.abort()
        })
      )
    )

    const fatal = failures.find((err) => !isRangeUnsupported(err))
    // A probe can say ranges are fine while the actual ranged requests get the
    // whole file back (a proxy or CDN edge stripping the header is the usual
    // reason). Without this, six "parts" would each write all 210 MB.
    if (fatal !== undefined) throw fatal

    if (failures.length > 0) {
      log('byte ranges are not honoured end to end; falling back to one connection')
      // The part files are meaningless to a single-connection retry, and leaving
      // them behind would make a later attempt treat them as resume state.
      removePartFiles(dest, parts)
      received = 0
      report(true)
      await fetchSingle(source, dest, total, bump, controller.signal, inactivityTimeoutMs)
      report(true)
      return { bytes: received, connections: 1 }
    }
    // Merge the ranges in order. Reading 210 MB back once costs a second or two
    // and buys a resume that needs no state file.
    //
    // The merge has to be *finished* before this function resolves: the caller
    // hashes the file and renames it into place the moment it returns, and a
    // still-flushing stream means a short read at best. On Windows it is worse —
    // the open handle made the rename fail with EBUSY, and deleting the part
    // files while the merge was still reading them could truncate the result.
    const out = createWriteStream(dest)
    try {
      for (const part of parts) {
        await new Promise<void>((resolve, reject) => {
          const input = createReadStream(partPath(dest, part.index))
          input.on('error', reject)
          input.on('end', resolve)
          input.pipe(out, { end: false })
        })
      }
      out.end()
      await finished(out)
    } catch (err) {
      out.destroy()
      throw err
    }
    removePartFiles(dest, parts)

    report(true)
    return { bytes: total, connections: parts.length }
  } finally {
    clearTimeout(overall)
  }
}

/**
 * Close a write stream and wait for it to actually finish.
 *
 * Waiting matters more than it looks. A failed fetch hands control straight back
 * to a caller that retries (the UI update retries on the spot), so a stream still
 * opening or flushing the same path would race the next attempt for the file.
 */
async function closeStream(stream: WriteStream): Promise<void> {
  if (stream.closed) return
  await new Promise<void>((resolve) => {
    stream.once('close', () => resolve())
    stream.destroy()
    // A stream that closed before this listener existed would be waited on
    // forever; `closed` is the only reliable way to notice.
    setImmediate(() => {
      if (stream.closed) resolve()
    })
  })
}

/**
 * A write stream that reports its own failure instead of throwing it at the process.
 *
 * Attaching this at creation, and not only around `end()`, is what keeps an abort
 * from taking the app down: a stream destroyed while its `open` is still in
 * flight emits `ERR_STREAM_DESTROYED`, and an `error` with no listener is an
 * unhandled exception in the main process.
 */
function trackStreamFailure(stream: WriteStream): () => Error | null {
  let failure: Error | null = null
  stream.on('error', (err: Error) => {
    failure ??= err
  })
  return () => failure
}

/** One connection, whole file, with the same inactivity rule. */
async function fetchSingle(
  source: PartSource,
  dest: string,
  total: number | null,
  onBytes: (n: number) => void,
  signal: AbortSignal,
  inactivityTimeoutMs: number
): Promise<void> {
  const out = createWriteStream(dest)
  const streamFailure = trackStreamFailure(out)
  const guard = createStallGuard(signal, inactivityTimeoutMs)
  let stopped = false
  try {
    await source.get(0, total === null ? Number.MAX_SAFE_INTEGER : total - 1, (chunk) => {
      // Data can still arrive after the guard aborted; writing it into a stream
      // being closed is the other half of ERR_STREAM_DESTROYED.
      if (stopped) return
      guard.touch()
      onBytes(chunk.length)
      out.write(chunk)
    }, guard.signal)
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve())
      out.on('error', reject)
    })
    const failure = streamFailure()
    if (failure) throw failure
  } catch (err) {
    stopped = true
    await closeStream(out)
    throw guard.explain(streamFailure() ?? err)
  } finally {
    guard.stop()
  }
}

/** One range, appended to its part file so an interrupted attempt keeps its bytes. */
async function fetchPart(
  source: PartSource,
  dest: string,
  part: DownloadPart,
  onBytes: (n: number) => void,
  signal: AbortSignal,
  inactivityTimeoutMs: number
): Promise<void> {
  const have = partBytesOnDisk(dest, part)
  const length = part.end - part.start + 1
  if (have === length) return

  const from = part.start + have
  const out = createWriteStream(partPath(dest, part.index), { flags: have > 0 ? 'a' : 'w' })
  const streamFailure = trackStreamFailure(out)
  const guard = createStallGuard(signal, inactivityTimeoutMs)
  let stopped = false
  try {
    await source.get(from, part.end, (chunk) => {
      if (stopped) return
      guard.touch()
      onBytes(chunk.length)
      out.write(chunk)
    }, guard.signal, { requireRange: true })
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve())
      out.on('error', reject)
    })
    const failure = streamFailure()
    if (failure) throw failure
  } catch (err) {
    // Keep what landed: the next attempt resumes from the part file's length.
    stopped = true
    await closeStream(out)
    throw guard.explain(streamFailure() ?? err)
  } finally {
    guard.stop()
  }
}

/**
 * Per-connection watchdog: abort when nothing arrives for `inactivityTimeoutMs`,
 * chained to the download-wide signal. It also remembers that IT caused the
 * abort, so the failure can be reported as "no data for N s" instead of a bare
 * transport error.
 */
function createStallGuard(
  signal: AbortSignal,
  inactivityTimeoutMs: number
): { signal: AbortSignal; touch: () => void; explain: (err: unknown) => Error; stop: () => void } {
  const controller = new AbortController()
  let lastAt = Date.now()
  let stalled = false
  const forward = (): void => controller.abort()
  if (signal.aborted) forward()
  else signal.addEventListener('abort', forward, { once: true })

  const timer = setInterval(() => {
    if (Date.now() - lastAt > inactivityTimeoutMs) {
      stalled = true
      controller.abort()
    }
  }, 1_000)

  return {
    signal: controller.signal,
    touch: () => {
      lastAt = Date.now()
    },
    explain: (err: unknown): Error =>
      stalled
        ? new Error(`no data for ${Math.round(inactivityTimeoutMs / 1000)}s; giving up`)
        : err instanceof Error
          ? err
          : new Error(String(err)),
    stop: () => {
      clearInterval(timer)
      signal.removeEventListener('abort', forward)
    },
  }
}
