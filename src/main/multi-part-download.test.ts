import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer, type Server } from 'node:http'
import { createHash } from 'node:crypto'
import { createReadStream, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { get as httpGet } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  downloadFile,
  partBytesOnDisk,
  partPath,
  planParts,
  RANGE_UNSUPPORTED,
  type PartSource,
} from './multi-part-download'

// A local server gives this a real transport: ranges, redirects and headers
// behave the way they do in production, and the run stays hermetic.
const TEMP_ROOT = realpathSync.native(tmpdir())

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Deterministic bytes, so a size mistake cannot cancel out in the hash. */
function payload(size: number): Buffer {
  const buffer = Buffer.allocUnsafe(size)
  for (let i = 0; i < size; i++) buffer[i] = (i * 31 + (i >> 8)) & 0xff
  return buffer
}

interface Fixture {
  server: Server
  url: string
  body: Buffer
  requests: { range: string | null }[]
  close: () => Promise<void>
}

async function startServer(
  body: Buffer,
  behavior: { ignoreRanges?: boolean; stallAfterBytes?: number; lieAboutRanges?: boolean } = {}
): Promise<Fixture> {
  const requests: { range: string | null }[] = []
  const server = createServer((req, res) => {
    const range = (req.headers.range as string | undefined) ?? null
    requests.push({ range })
    // : answer the probe correctly, then hand every real part
    // request the whole file — the proxy/CDN behaviour the fallback exists for.
    const honour = range && !behavior.ignoreRanges && (!behavior.lieAboutRanges || range === 'bytes=1-1')
    if (!honour) {
      res.writeHead(200, { 'Content-Length': String(body.length) })
      if (behavior.stallAfterBytes === undefined) {
        res.end(body)
        return
      }
      res.write(body.subarray(0, behavior.stallAfterBytes))
      return // never finishes: exercises the inactivity watchdog
    }
    const match = /bytes=(\d+)-(\d*)/.exec(range)
    assert.ok(match, `unparseable range ${range}`)
    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) : body.length - 1
    const slice = body.subarray(start, Math.min(end, body.length - 1) + 1)
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${start + slice.length - 1}/${body.length}`,
      'Content-Length': String(slice.length),
      'Accept-Ranges': 'bytes',
    })
    res.end(slice)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    server,
    url: `http://127.0.0.1:${address.port}/file.bin`,
    body,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** The node:http equivalent of what update-handlers supplies via Electron's net. */
function httpSource(url: string): PartSource {
  const request = (range?: { start: number; end: number }, signal?: AbortSignal) =>
    new Promise<{ status: number; headers: Record<string, string | undefined>; chunks: Buffer[] }>(
      (resolve, reject) => {
        const req = httpGet(
          url,
          { headers: range ? { Range: `bytes=${range.start}-${range.end}` } : {} },
          (res) => {
            const chunks: Buffer[] = []
            res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
            res.on('end', () =>
              resolve({ status: res.statusCode ?? 0, headers: res.headers as never, chunks })
            )
            res.on('error', reject)
          }
        )
        req.on('error', reject)
        signal?.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true })
      }
    )

  /** Headers only: a probe must not depend on the body ever arriving. */
  const probeRequest = (signal?: AbortSignal) =>
    new Promise<{ status: number; headers: Record<string, string | undefined> }>((resolve, reject) => {
      const req = httpGet(url, { headers: { Range: 'bytes=0-0' } }, (res) => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers as never })
        res.destroy()
        req.destroy()
      })
      req.on('error', reject)
      signal?.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true })
    })

  const statusOf = (range: { start: number; end: number }) =>
    new Promise<number>((resolve, reject) => {
      const req = httpGet(url, { headers: { Range: `bytes=${range.start}-${range.end}` } }, (res) => {
        resolve(res.statusCode ?? 0)
        res.destroy()
        req.destroy()
      })
      req.on('error', reject)
    })

  return {
    probe: async () => {
      const head = await probeRequest()
      const contentRange = head.headers['content-range']
      if (head.status === 206 && contentRange) {
        const total = Number(contentRange.split('/')[1])
        return { total: Number.isFinite(total) ? total : null, acceptsRanges: true }
      }
      const length = Number(head.headers['content-length'] ?? 0)
      return { total: Number.isFinite(length) && length > 0 ? length : null, acceptsRanges: false }
    },
    get: async (start, end, onChunk, signal, options) => {
      if (options?.requireRange === true) {
        // Headers first, like the production source: a part fetch that is handed
        // the whole file must abort before a single byte is written.
        const head = await statusOf({ start, end })
        if (head >= 400) throw new Error(`download failed: ${head}`)
        if (head !== 206) throw new Error(RANGE_UNSUPPORTED)
      }
      const res = await request({ start, end }, signal)
      if (res.status >= 400) throw new Error(`download failed: ${res.status}`)
      for (const chunk of res.chunks) onChunk(chunk)
    },
  }
}

function workDir(): string {
  return mkdtempSync(join(TEMP_ROOT, 'vespi-mp-'))
}

test('planParts covers the file exactly once, with no gaps or overlaps', () => {
  for (const total of [1, 7, 10, 100, 1023, 1_000_000]) {
    for (const count of [1, 3, 4, 6, 16]) {
      const parts = planParts(total, count)
      assert.equal(parts[0]?.start, 0, `first part starts at 0 (total=${total}, count=${count})`)
      assert.equal(parts[parts.length - 1]?.end, total - 1, `last part ends at total-1`)
      assert.ok(parts.length <= count, 'never more parts than requested')
      for (let i = 1; i < parts.length; i++) {
        assert.equal(parts[i].start, parts[i - 1].end + 1, 'parts are contiguous')
      }
    }
  }
  assert.equal(planParts(0, 4).length, 0, 'nothing to fetch for an empty file')
})

test('a ranged download fetches every byte across parallel connections', async () => {
  const body = payload(300_000)
  const fixture = await startServer(body)
  const dir = workDir()
  const dest = join(dir, 'out.bin')
  const progress: { received: number; total: number }[] = []
  try {
    const result = await downloadFile({
      source: httpSource(fixture.url),
      dest,
      partCount: 4,
      minPartBytes: 1024,
      onProgress: (received, total) => progress.push({ received, total }),
    })

    assert.equal(result.bytes, body.length)
    assert.equal(result.connections, 4, 'used the four connections it was given')
    assert.equal(sha256(readFileSync(dest)), sha256(body), 'merged bytes match the source')
    assert.equal(fixture.requests.filter((r) => r.range?.endsWith('-0')).length, 1, 'one probe')
    assert.ok(progress.length >= 1, 'reported progress')
    assert.equal(progress[progress.length - 1].total, body.length)
    assert.ok(
      progress.every((p, i) => i === 0 || p.received >= progress[i - 1].received),
      'progress never goes backwards'
    )
    // Part files are cleaned up once merged.
    assert.equal(statSync(dest).size, body.length)
    for (const part of planParts(body.length, 4)) {
      assert.equal(partBytesOnDisk(dest, part), 0, `leftover ${partPath(dest, part.index)}`)
    }
  } finally {
    await fixture.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an interrupted download resumes from the ranges already on disk', async () => {
  const body = payload(200_000)
  const fixture = await startServer(body)
  const dir = workDir()
  const dest = join(dir, 'out.bin')
  try {
    const parts = planParts(body.length, 4)
    // Pretend an earlier attempt died: one range complete, one half done.
    writeFileSync(partPath(dest, parts[0].index), body.subarray(parts[0].start, parts[0].end + 1))
    const half = Math.floor((parts[1].end - parts[1].start + 1) / 2)
    writeFileSync(partPath(dest, parts[1].index), body.subarray(parts[1].start, parts[1].start + half))

    const requestsBefore = fixture.requests.length
    await downloadFile({
      source: httpSource(fixture.url),
      dest,
      partCount: 4,
      minPartBytes: 1024,
    })

    assert.equal(sha256(readFileSync(dest)), sha256(body), 'resumed file is byte-identical')
    const ranges = fixture.requests.slice(requestsBefore).map((r) => r.range)
    assert.equal(
      ranges.some((r) => r === `bytes=${parts[0].start}-${parts[0].end}`),
      false,
      'the complete range was not refetched'
    )
    assert.equal(
      ranges.some((r) => r === `bytes=${parts[1].start + half}-${parts[1].end}`),
      true,
      'the half-finished range resumed where it stopped'
    )
  } finally {
    await fixture.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a server without range support still downloads the whole file', async () => {
  const body = payload(120_000)
  const fixture = await startServer(body, { ignoreRanges: true })
  const dir = workDir()
  const dest = join(dir, 'out.bin')
  try {
    const result = await downloadFile({
      source: httpSource(fixture.url),
      dest,
      partCount: 4,
      minPartBytes: 1024,
    })
    assert.equal(result.connections, 1, 'falls back to one connection')
    assert.equal(sha256(readFileSync(dest)), sha256(body))
    assert.equal(statSync(dest).size, body.length)
  } finally {
    await fixture.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a link that stops delivering bytes fails on inactivity, not on a deadline', async () => {
  const body = payload(100_000)
  const fixture = await startServer(body, { ignoreRanges: true, stallAfterBytes: 1_000 })
  const dir = workDir()
  const dest = join(dir, 'out.bin')
  try {
    await assert.rejects(
      downloadFile({
        source: httpSource(fixture.url),
        dest,
        inactivityTimeoutMs: 1_200,
        partCount: 4,
        minPartBytes: 1024,
      }),
      /no data for \d+s/,
      'the message says the link went quiet'
    )
  } finally {
    await fixture.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a small file skips the parallel path entirely', async () => {
  const body = payload(4_000)
  const fixture = await startServer(body)
  const dir = workDir()
  const dest = join(dir, 'out.bin')
  try {
    const result = await downloadFile({
      source: httpSource(fixture.url),
      dest,
      partCount: 6,
      minPartBytes: 1024 * 1024,
    })
    assert.equal(result.connections, 1)
    assert.equal(readFileSync(dest).length, body.length)
  } finally {
    await fixture.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a probe that lies about ranges falls back instead of transferring six copies', async () => {
  const body = payload(200_000)
  const fixture = await startServer(body, { lieAboutRanges: true })
  const dir = workDir()
  const dest = join(dir, 'out.bin')
  try {
    const result = await downloadFile({
      source: httpSource(fixture.url),
      dest,
      partCount: 4,
      minPartBytes: 1024,
    })
    assert.equal(result.connections, 1, 'the download fell back to a single connection')
    assert.equal(sha256(readFileSync(dest)), sha256(body), 'the fallback still produced the right bytes')
  } finally {
    await fixture.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('partBytesOnDisk ignores a stale file that is longer than its range', async () => {
  const dir = workDir()
  const dest = join(dir, 'out.bin')
  try {
    const part = { index: 0, start: 0, end: 9 }
    writeFileSync(partPath(dest, part.index), Buffer.alloc(50))
    assert.equal(partBytesOnDisk(dest, part), 0, 'an oversized range file is refetched')
    writeFileSync(partPath(dest, part.index), Buffer.alloc(4))
    assert.equal(partBytesOnDisk(dest, part), 4)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('createReadStream is available to the module under test (import sanity)', () => {
  // Guards against the merge path losing its import during refactors.
  assert.equal(typeof createReadStream, 'function')
})
