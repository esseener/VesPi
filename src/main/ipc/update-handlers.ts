import { ipcMain, app, BrowserWindow, net, session, shell } from 'electron'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { chmod, copyFile, mkdir, readdir, rename, rm, stat, unlink } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { tmpdir } from 'os'
import type {
  KernelUpdateInfo,
  KernelUpdateProgress,
  UpdateCheckErrorKind,
  UpdateCheckResult,
} from '../../shared/ipc-contracts'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { appLog } from '../app-log'
import { updateOrder } from '../update-order'
import { beginInstallerHandover, confirmInstallerHandover } from '../installer-handoff'
import {
  formatInstalledKernelMarker,
  installedKernelMarkerPath,
  readInstalledKernelVersion,
} from '../kernel-version-marker'
import { extractVersionLine } from '../diagnostics-report'
import { downloadFile, RANGE_UNSUPPORTED, type PartSource } from '../multi-part-download'
import { runPiCli } from './run-pi-cli'
import { resolvePrivateOmpPath } from '../vespi-runtime'
import { rebuildOmpLabelPack } from '../omp-label-pack'

const UPDATE_REPO = 'esseener/VesPi'
const KERNEL_REPO = 'can1357/oh-my-pi'
const UPDATE_CHECK_TIMEOUT_MS = 8000
/**
 * How long a *connection* may go without delivering bytes before the download is
 * abandoned. This is deliberately not a deadline for the whole transfer: the old
 * 10-minute cap meant a 210 MB installer needed a sustained 350 KB/s or it failed
 * with "timed out" on links that were merely slow but perfectly healthy.
 */
const DOWNLOAD_INACTIVITY_TIMEOUT_MS = 45_000
/** Backstop so a pathological link cannot hang the update forever. */
const DOWNLOAD_OVERALL_TIMEOUT_MS = 60 * 60_000
/**
 * Fetching `SHA256SUMS.txt` is a tiny request, and this timeout is not used for
 * anything measured in megabytes — but it was 8 s (the release *check* budget),
 * which a 210 MB download's worth of throttling would blow straight through.
 * A flaky moment fetching a 90-byte file must not cost the user an installer they
 * already downloaded, so it gets its own, more forgiving budget.
 */
const CHECKSUM_FETCH_TIMEOUT_MS = 30_000
/**
 * How many times one "install update" click tries to get a verified installer.
 * Retrying is only cheap because the parts stay on disk (see `uiUpdateCacheDir`):
 * an attempt that already fetched five of six ranges only pays for the sixth.
 */
const UI_UPDATE_ATTEMPTS = 3
/** Wait between attempts, growing: 2 s, then 4 s. */
const UI_UPDATE_RETRY_DELAY_MS = 2_000
/**
 * How long a kernel release check is reused. The kernel lands roughly weekly, and
 * every check spends one of the 60 anonymous GitHub requests per hour that the
 * whole proxy exit shares — so there is nothing to gain from asking every half
 * hour. Cleared when a kernel is installed, so the next check is honest.
 */
const KERNEL_CHECK_TTL_MS = 2 * 60 * 60_000
let kernelCheckCache: { info: KernelUpdateInfo; at: number } | null = null
const USER_AGENT = 'VesPi'

/**
 * Sorts a failed release check into the three cases the UI treats differently:
 * a shared-exit quota limit (wait, it retries itself), a network/proxy problem,
 * or something else. The raw message still goes to the user — this only decides
 * the tone and whether an automatic retry is worth scheduling.
 */
function classifyNetworkError(err: unknown): UpdateCheckErrorKind {
  const raw = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (raw.includes('403')) return 'rate-limit'
  if (
    raw.includes('timed out') ||
    raw.includes('timeout') ||
    raw.includes('abort') ||
    raw.includes('proxy') ||
    raw.includes('enotfound') ||
    raw.includes('econn') ||
    raw.includes('socket')
  ) {
    return 'network'
  }
  return 'other'
}

interface GithubAsset {
  name: string
  browser_download_url: string
}

interface GithubRelease {
  tag_name: string
  html_url: string
  name: string | null
  draft: boolean
  prerelease: boolean
  assets?: GithubAsset[]
}

/** Parse a version like "0.0.5-alpha" or "omp/18.0.11" into numeric core + prerelease tag. */
export function parseVersion(version: string): { core: number[]; pre: string } {
  const clean = version.replace(/^v/, '').replace(/^omp[/\\]/i, '').trim()
  const [core, pre = ''] = clean.split('-')
  const nums = core.split('.').map((n) => parseInt(n, 10) || 0)
  while (nums.length < 3) nums.push(0)
  return { core: nums.slice(0, 3), pre }
}

/**
 * True when `latest` is a newer version than `current`. Handles the project's
 * `x.y.z-prerelease` scheme: a release with no prerelease tag outranks one with
 * the same core that has a tag; two prerelease tags compare lexically
 * (alpha < beta < rc).
 */
function comparePrerelease(a: string, b: string): number {
  if (a === b) return 0
  if (!a) return 1
  if (!b) return -1
  const left = a.split('.')
  const right = b.split('.')
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const x = left[i]
    const y = right[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) return Number(x) > Number(y) ? 1 : -1
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}

export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i]
  }
  return comparePrerelease(a.pre, b.pre) > 0
}

export function vespiInstallerAssetName(version: string, platform = process.platform, arch = process.arch): string | null {
  if (platform !== 'win32' || arch === 'arm64') return null
  const clean = version.replace(/^v/, '')
  return `VesPi-Setup-${clean}-win-x64.exe`
}

export function ompAssetName(platform = process.platform, arch = process.arch): string {
  if (platform === 'win32') return arch === 'arm64' ? 'omp-windows-arm64.exe' : 'omp-windows-x64.exe'
  if (platform === 'darwin') return arch === 'arm64' ? 'omp-darwin-arm64' : 'omp-darwin-x64'
  if (arch === 'arm64') return 'omp-linux-arm64'
  return 'omp-linux-x64'
}

function emptyKernel(currentVersion: string): KernelUpdateInfo {
  return { updateAvailable: false, currentVersion, latestVersion: currentVersion, url: '', downloadUrl: '' }
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

function githubHostAllowed(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'api.github.com' || host === 'github.com' || host.endsWith('.githubusercontent.com')
  } catch {
    return false
  }
}

function friendlyNetworkError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const lower = raw.toLowerCase()
  if (lower.includes('403')) {
    return 'GitHub 拒绝了这次请求（403）。最常见的原因是接口限流：未登录请求每小时只有 60 次、按出口 IP 计，而代理或 VPN 的出口常被多人共用，配额容易被用光。等几分钟再试，或换一个节点。'
  }
  if (lower.includes('no data for')) {
    return '下载中断：连续 45 秒没有收到任何数据。网络看着是通的、但这条连接已经卡死了。若用代理或 VPN，请确认 *.githubusercontent.com 也在代理规则里——安装包是从这个域名下载的，只代理 github.com 的话大文件往往走不到代理。'
  }
  if (lower.includes('abort') || lower.includes('timed out') || lower.includes('timeout')) {
    return '连接 GitHub 超时。更新走 api.github.com，请开系统代理或 TUN/增强模式后重试。'
  }
  if (
    lower.includes('enotfound')
    || lower.includes('eai_again')
    || lower.includes('network')
    || lower.includes('offline')
    || lower.includes('failed to fetch')
    || lower.includes('err_connection')
    || lower.includes('err_name_not_resolved')
    || lower.includes('err_tunnel')
    || lower.includes('err_proxy')
  ) {
    return '连不上 GitHub。普通浏览器梯子往往只管浏览器；请开系统代理或 TUN，并允许 VesPi 走代理。'
  }
  return raw
}

function netRequest(url: string): Electron.ClientRequest {
  return net.request({
    method: 'GET',
    url,
    session: session.defaultSession,
    redirect: 'follow',
  })
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  if (!isHttpsUrl(url) || !githubHostAllowed(url)) {
    throw new Error('Update URL is not an allowed GitHub HTTPS host')
  }
  return await new Promise<T>((resolve, reject) => {
    const req = netRequest(url)
    req.setHeader('Accept', 'application/vnd.github+json')
    req.setHeader('User-Agent', USER_AGENT)
    const timer = setTimeout(() => {
      req.abort()
      reject(new Error('timed out'))
    }, timeoutMs)
    req.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => {
        clearTimeout(timer)
        const body = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode !== 200) {
          reject(new Error(`${res.statusCode} ${res.statusMessage ?? ''}`.trim()))
          return
        }
        try {
          resolve(JSON.parse(body) as T)
        } catch (err) {
          reject(err)
        }
      })
      res.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
    req.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    req.end()
  })
}

export function pickLatestRelease(releases: GithubRelease[], includePrerelease = false): GithubRelease | null {
  const published = releases.filter((r) => !r.draft && (includePrerelease || !r.prerelease))
  if (published.length === 0) return null
  let latest = published[0]
  for (const r of published) {
    if (isNewerVersion(r.tag_name.replace(/^v/, ''), latest.tag_name.replace(/^v/, ''))) latest = r
  }
  return latest
}

/**
 * The version of the kernel currently on disk.
 *
 * The marker is tried first. Asking the binary directly means spawning a ~154 MB
 * Bun build, and this runs on launch and every 30 minutes; a marker that cannot
 * be trusted (absent, or describing a different file) falls through to the probe.
 *
 * The probe asks for the **omp** engine explicitly: the ambient resolution can
 * be Pi, and Pi's version is not the kernel's version.
 */
async function currentOmpVersion(): Promise<string> {
  const dest = resolvePrivateOmpPath()
  const cached = dest ? readCachedKernelVersion(dest) : null
  if (cached) return cached

  const cwd = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd()
  const result = await runPiCli(['--version'], cwd, 8_000, 'omp')
  if (!result.success) return ''
  const line = extractVersionLine(result.output)
  if (!line) return ''
  const match = line.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/)
  const version = match?.[1] ?? line
  // Record it, so the next check does not have to run the kernel again.
  if (dest) writeKernelVersionMarker(dest, version)
  return version
}

/** The version a marker records for this binary, or null when it cannot vouch. */
function readCachedKernelVersion(ompPath: string): string | null {
  try {
    const markerPath = installedKernelMarkerPath(ompPath)
    if (!existsSync(markerPath)) return null
    const stat = statSync(ompPath)
    return readInstalledKernelVersion(readFileSync(markerPath, 'utf-8'), {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    })
  } catch {
    return null
  }
}

/** Best-effort: a marker that cannot be written only costs the next probe. */
function writeKernelVersionMarker(ompPath: string, version: string): void {
  try {
    const stat = statSync(ompPath)
    writeFileSync(
      installedKernelMarkerPath(ompPath),
      formatInstalledKernelMarker(version, { size: stat.size, mtimeMs: stat.mtimeMs }),
      'utf-8',
    )
  } catch {
    // Nothing to recover: the version is still discoverable by probing.
  }
}

async function checkVespiUpdate(): Promise<Omit<UpdateCheckResult, 'kernel'>> {
  const currentVersion = app.getVersion()
  const none = { updateAvailable: false, currentVersion, latestVersion: currentVersion, url: '' }
  try {
    const releases = await fetchJson<GithubRelease[]>(
      `https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=10`,
      UPDATE_CHECK_TIMEOUT_MS,
    )
    const latest = pickLatestRelease(releases)
    if (!latest) return none
    const latestVersion = latest.tag_name.replace(/^v/, '')
    const installerName = vespiInstallerAssetName(latestVersion)
    const installer = installerName
      ? latest.assets?.find((item) => item.name === installerName)
      : undefined
    return {
      updateAvailable: isNewerVersion(latestVersion, currentVersion),
      currentVersion,
      latestVersion,
      url: latest.html_url,
      installerUrl: installer?.browser_download_url ?? '',
      name: latest.name ?? latest.tag_name,
    }
  } catch (err) {
    appLog.warn('updates', 'VesPi update check failed', err)
    return { ...none, checkError: friendlyNetworkError(err), checkErrorKind: classifyNetworkError(err) }
  }
}

async function checkKernelUpdate(): Promise<KernelUpdateInfo> {
  if (kernelCheckCache && Date.now() - kernelCheckCache.at < KERNEL_CHECK_TTL_MS) {
    return kernelCheckCache.info
  }
  const currentVersion = await currentOmpVersion()
  const none = emptyKernel(currentVersion)
  try {
    const releases = await fetchJson<GithubRelease[]>(
      `https://api.github.com/repos/${KERNEL_REPO}/releases?per_page=10`,
      UPDATE_CHECK_TIMEOUT_MS,
    )
    const latest = pickLatestRelease(releases)
    if (!latest) return none
    const latestVersion = latest.tag_name.replace(/^v/, '')
    const asset = latest.assets?.find((item) => item.name === ompAssetName())
    const info: KernelUpdateInfo = {
      updateAvailable: currentVersion ? isNewerVersion(latestVersion, currentVersion) : Boolean(asset),
      currentVersion,
      latestVersion,
      url: latest.html_url,
      downloadUrl: asset?.browser_download_url ?? '',
    }
    // Only a successful check is worth caching; a failure has to be retryable.
    kernelCheckCache = { info, at: Date.now() }
    return info
  } catch (err) {
    appLog.warn('updates', 'OMP kernel update check failed', err)
    return { ...none, checkError: friendlyNetworkError(err), checkErrorKind: classifyNetworkError(err) }
  }
}

async function checkForUpdate(): Promise<UpdateCheckResult> {
  const [vespi, kernel] = await Promise.all([checkVespiUpdate(), checkKernelUpdate()])
  return { ...vespi, kernel }
}

function broadcastKernelProgress(progress: KernelUpdateProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(IPC_CHANNELS.EVENT_KERNEL_UPDATE_PROGRESS, progress)
  }
}

/**
 * Byte-range source built on Electron's `net`, so downloads use the same session
 * — and therefore the same proxy rules — as the rest of the app.
 *
 * `headOnly` resolves on the response headers and hangs up: a probe must not
 * depend on a body ever arriving, and the asset's first bytes are not needed to
 * learn its size.
 */
function netPartSource(url: string): PartSource {
  if (!isHttpsUrl(url) || !githubHostAllowed(url)) {
    throw new Error('Download URL is not an allowed GitHub HTTPS host')
  }

  const send = (
    range: { start: number; end: number },
    onChunk: (chunk: Buffer) => void,
    signal: AbortSignal,
    options: { headOnly?: boolean; requireRange?: boolean } = {},
  ): Promise<{ status: number; contentRange: string | null; contentLength: number | null }> =>
    new Promise((resolve, reject) => {
      const req = netRequest(url)
      req.setHeader('User-Agent', USER_AGENT)
      req.setHeader('Accept', 'application/octet-stream')
      req.setHeader('Range', `bytes=${range.start}-${range.end}`)

      const abort = (): void => {
        req.abort()
        reject(new Error('aborted'))
      }
      if (signal.aborted) {
        abort()
        return
      }
      signal.addEventListener('abort', abort, { once: true })

      req.on('response', (res) => {
        const status = res.statusCode ?? 0
        const contentRange = (res.headers['content-range'] as string | undefined) ?? null
        const contentLength = res.headers['content-length']
          ? Number(res.headers['content-length'])
          : null
        if (status >= 400) {
          res.on('data', () => {})
          res.on('end', () => reject(new Error(`Download failed: ${status} ${res.statusMessage ?? ''}`.trim())))
          res.on('error', reject)
          return
        }
        // A part fetch that gets the whole file back must not write it into the
        // range's file: stop before a single chunk lands and let the downloader
        // fall back to one connection. A probe reports 200 too, and that is
        // simply "this endpoint does not do ranges" — hence `requireRange`.
        if (options.requireRange === true && status !== 206) {
          res.on('data', () => {})
          res.on('error', () => {})
          req.abort()
          reject(new Error(RANGE_UNSUPPORTED))
          return
        }
        if (options.headOnly === true) {
          res.on('error', () => {})
          res.on('data', () => {})
          resolve({ status, contentRange, contentLength })
          req.abort()
          return
        }
        res.on('data', (chunk) => onChunk(Buffer.from(chunk)))
        res.on('end', () => resolve({ status, contentRange, contentLength }))
        res.on('error', reject)
      })
      req.on('error', (err: Error) => {
        // An abort we asked for is reported by the caller's own message.
        if (!signal.aborted) reject(err)
      })
      req.end()
    })

  return {
    probe: async () => {
      const controller = new AbortController()
      // A probe that never answers must not become the new way to hang: the
      // download-wide backstop is an hour long.
      const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS)
      try {
        // Ask for a byte that is *not* the first one: some CDNs answer `bytes=0-0`
        // with the whole file, which would look like "ranges unsupported".
        const head = await send({ start: 1, end: 1 }, () => {}, controller.signal, { headOnly: true })
        if (head.status === 206 && head.contentRange) {
          const total = Number(head.contentRange.split('/')[1])
          return { total: Number.isFinite(total) ? total : null, acceptsRanges: true }
        }
        return { total: head.contentLength, acceptsRanges: false }
      } finally {
        clearTimeout(timer)
      }
    },
    get: async (start, end, onChunk, signal, options) => {
      await send({ start, end }, onChunk, signal, { requireRange: options?.requireRange === true })
    },
  }
}

async function downloadToFile(
  url: string,
  dest: string,
  onProgress?: (received: number, total: number) => void,
): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  const result = await downloadFile({
    source: netPartSource(url),
    dest,
    ...(onProgress !== undefined ? { onProgress } : {}),
    inactivityTimeoutMs: DOWNLOAD_INACTIVITY_TIMEOUT_MS,
    overallTimeoutMs: DOWNLOAD_OVERALL_TIMEOUT_MS,
    log: (message) => appLog.info('updates', message),
  })
  appLog.info('updates', `Downloaded ${result.bytes} bytes over ${result.connections} connection(s)`)
}

async function fetchBytes(url: string, timeoutMs: number): Promise<Buffer> {
  if (!isHttpsUrl(url) || !githubHostAllowed(url)) {
    throw new Error('Download URL is not an allowed GitHub HTTPS host')
  }
  return await new Promise<Buffer>((resolve, reject) => {
    const req = netRequest(url)
    req.setHeader('User-Agent', USER_AGENT)
    req.setHeader('Accept', 'application/octet-stream')
    const timer = setTimeout(() => {
      req.abort()
      reject(new Error('timed out'))
    }, timeoutMs)
    const chunks: Buffer[] = []
    req.on('response', (res) => {
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => {
        clearTimeout(timer)
        if (res.statusCode !== 200) {
          reject(new Error(`${res.statusCode} ${res.statusMessage ?? ''}`.trim()))
          return
        }
        resolve(Buffer.concat(chunks))
      })
      res.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
    req.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    req.end()
  })
}

function sha256OfFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(path)
    input.on('error', reject)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('end', () => resolve(hash.digest('hex')))
  })
}

/** Parse `sha256sum`-style output and return the expected hash for one asset. */
export function parseSha256Sum(sumsText: string, assetName: string): string | null {
  for (const line of sumsText.split(/\r?\n/)) {
    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/)
    if (!match) continue
    const name = match[2].trim()
    if (name === assetName || basename(name) === assetName) return match[1].toLowerCase()
  }
  return null
}

export function checksumUrlForAsset(downloadUrl: string): string {
  const url = new URL(downloadUrl)
  url.pathname = `${url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1)}SHA256SUMS.txt`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function assetNameOf(downloadUrl: string): string {
  const assetName = decodeURIComponent(new URL(downloadUrl).pathname.split('/').pop() ?? '')
  if (!assetName) throw new Error('Release asset URL has no filename')
  return assetName
}

/**
 * The expected hash, fetched separately from comparing it.
 *
 * The two failures are not the same thing and must not be handled the same way:
 * failing to *fetch* a 90-byte manifest is a network problem that leaves an
 * already-downloaded installer perfectly good, while a hash mismatch means the
 * bytes themselves are wrong. Only the second justifies deleting the file — and
 * throwing away 210 MB because the network hiccuped is exactly what made an
 * update look impossible to finish.
 */
async function fetchExpectedChecksum(downloadUrl: string): Promise<{ assetName: string; hash: string }> {
  const assetName = assetNameOf(downloadUrl)
  const sumsText = (await fetchBytes(checksumUrlForAsset(downloadUrl), CHECKSUM_FETCH_TIMEOUT_MS)).toString('utf8')
  const hash = parseSha256Sum(sumsText, assetName)
  if (!hash) throw new Error(`SHA256SUMS.txt has no checksum for ${assetName}; refusing to install`)
  return { assetName, hash }
}

/** Whether `filePath` already holds exactly the bytes the checksum describes. */
async function fileMatchesChecksum(filePath: string, expectedHash: string): Promise<boolean> {
  const info = await stat(filePath).catch(() => null)
  if (!info || !info.isFile() || info.size === 0) return false
  return (await sha256OfFile(filePath)) === expectedHash
}

/**
 * Compare a file against its published hash, deleting it when the bytes are
 * wrong so the next attempt cannot keep reusing a corrupt file.
 */
async function assertAssetChecksum(downloadUrl: string, filePath: string, expectedHash: string): Promise<void> {
  const actualHash = await sha256OfFile(filePath)
  if (actualHash === expectedHash) return
  await rm(filePath, { force: true }).catch(() => {})
  throw new Error(
    `Checksum mismatch for ${assetNameOf(downloadUrl)} (expected ${expectedHash.slice(0, 12)}…, got ${actualHash.slice(0, 12)}…); refusing to install`,
  )
}

async function verifyReleaseAsset(downloadUrl: string, filePath: string): Promise<void> {
  const { hash } = await fetchExpectedChecksum(downloadUrl)
  await assertAssetChecksum(downloadUrl, filePath, hash)
}

function sameVersion(a: string, b: string): boolean {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  return pa.core.join('.') === pb.core.join('.') && pa.pre === pb.pre
}

const execFileAsync = promisify(execFile)

/**
 * Run a freshly downloaded kernel with `--version` before it replaces the
 * working one. Returns the version it reports ('' when it runs but the output
 * is unparseable) or null when the binary fails to start at all.
 */
async function probeBinaryVersion(binaryPath: string): Promise<string | null> {
  const cwd = process.env.USERPROFILE ?? process.env.HOME ?? process.cwd()
  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, ['--version'], {
      cwd,
      timeout: 15_000,
      windowsHide: true,
    })
    const line = extractVersionLine(stdout + stderr)
    if (!line) return ''
    const match = line.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/)
    return match?.[1] ?? ''
  } catch {
    return null
  }
}

/**
 * Install the newest OMP kernel.
 *
 * Serialized against other kernel applies (the swap is not reentrant) and
 * refused once the UI installer has taken over the app — see `update-order.ts`
 * for why the two must be ordered rather than raced.
 */
export async function installKernelUpdate(): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  if (updateOrder.hasUiInstallerLaunched()) {
    return { ok: false, error: '界面更新已经开始安装，请等它完成并重启后再更新内核' }
  }
  return updateOrder.trackKernelApply(() => installKernelUpdateInner())
}

async function installKernelUpdateInner(): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  const kernel = await checkKernelUpdate()
  if (!kernel.updateAvailable) return { ok: false, error: 'OMP kernel is already up to date' }
  if (!kernel.downloadUrl) return { ok: false, error: 'No OMP binary is published for this platform' }
  const dest = resolvePrivateOmpPath()
  if (!dest) return { ok: false, error: 'Private OMP binary was not found' }

  const staged = `${dest}.new`
  const backup = `${dest}.bak`
  let movedAside = false
  try {
    broadcastKernelProgress({ phase: 'downloading', percent: 0, receivedBytes: 0, totalBytes: 0, version: kernel.latestVersion })
    await downloadToFile(kernel.downloadUrl, staged, (received, total) => {
      const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0
      broadcastKernelProgress({
        phase: 'downloading',
        percent,
        receivedBytes: received,
        totalBytes: total,
        version: kernel.latestVersion,
      })
    })

    // Fingerprint: every executable must match the release checksum manifest
    // before it is probed or opened.
    broadcastKernelProgress({ phase: 'installing', percent: 100, receivedBytes: 0, totalBytes: 0, version: kernel.latestVersion })
    await verifyReleaseAsset(kernel.downloadUrl, staged)

    // Health check: the staged binary must run, and it must report the very
    // version we asked for. Only then is the current kernel moved aside.
    const stagedVersion = await probeBinaryVersion(staged)
    if (!stagedVersion) throw new Error('New kernel did not report a valid version; keeping the current version')
    if (!sameVersion(stagedVersion, kernel.latestVersion)) {
      throw new Error(`Downloaded binary reports ${stagedVersion} but release is ${kernel.latestVersion}; refusing to install`)
    }

    try { await unlink(backup) } catch { /* no previous backup */ }
    try {
      await rename(dest, backup)
    } catch {
      await copyFile(dest, backup)
      await unlink(dest)
    }
    movedAside = true
    try {
      await rename(staged, dest)
    } catch {
      await copyFile(staged, dest)
      await unlink(staged)
    }
    if (process.platform !== 'win32') await chmod(dest, 0o755)

    // Read the result back before claiming success. Every call above returned
    // without throwing, but "the calls returned" is not evidence that the file
    // on disk changed — and a kernel update that reports success while leaving
    // the old binary in place is worse than one that fails loudly, because the
    // user then waits for a version that never arrives and nothing in the log
    // says why. Seen in the wild on 2026-09-14: the log said `Installed OMP
    // kernel 18.1.21` while the file was still 18.1.20, with no `.bak` left to
    // explain it. Throwing here instead turns that into a loud failure that the
    // rollback below undoes.
    const installedVersion = await probeBinaryVersion(dest)
    if (!installedVersion) {
      throw new Error('The installed kernel does not run; restoring the previous one')
    }
    if (!sameVersion(installedVersion, kernel.latestVersion)) {
      throw new Error(`The installed kernel reports ${installedVersion} but should be ${kernel.latestVersion}`)
    }

    // We know exactly what we just put there, so record it instead of making the
    // next update check spawn the kernel to ask.
    writeKernelVersionMarker(dest, kernel.latestVersion)
    // The cached check predates this install; without dropping it the About page
    // would keep offering the version that is already on disk.
    kernelCheckCache = null
    appLog.warn('updates', `Installed OMP kernel ${kernel.latestVersion} at ${dest}`)
    broadcastKernelProgress({ phase: 'done', percent: 100, receivedBytes: 0, totalBytes: 0, version: kernel.latestVersion })
    void rebuildOmpLabelPack(kernel.latestVersion).catch(() => undefined)
    return { ok: true, version: kernel.latestVersion }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    appLog.warn('updates', 'OMP kernel install failed', err)
    // Roll back if the working binary was already moved aside but installing
    // the new one did not complete — the old code left the install half-done.
    if (movedAside) {
      try { await unlink(dest) } catch { /* nothing to clear */ }
      try {
        await rename(backup, dest)
      } catch {
        try {
          await copyFile(backup, dest)
        } catch (rollbackErr) {
          appLog.error('updates', 'Kernel rollback failed — restore .bak manually', rollbackErr)
        }
      }
    }
    try { await unlink(staged) } catch { /* ignore */ }
    broadcastKernelProgress({ phase: 'error', percent: 0, receivedBytes: 0, totalBytes: 0, error: message })
    return { ok: false, error: friendlyNetworkError(new Error(message)) }
  }
}

function broadcastUiProgress(progress: KernelUpdateProgress): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(IPC_CHANNELS.EVENT_UI_UPDATE_PROGRESS, progress)
  }
}

/**
 * Where the UI installer is staged.
 *
 * A fixed path, deliberately — not a fresh `mkdtemp` per attempt. The `.partN`
 * files beside the installer *are* the resume state (`multi-part-download.ts`),
 * so throwing the directory away between attempts makes every retry re-fetch all
 * 210 MB from byte zero. That asymmetry is exactly why an update could hang at
 * 70 % forever while the kernel download beside it resumed fine ("5/6 ranges
 * already complete") and completed.
 */
export function uiUpdateCacheDir(): string {
  return join(tmpdir(), 'vespi-update')
}

/**
 * Which cache entries belong to the update in flight. Anything else is left over
 * from a version that is no longer the target, and is pruned so the cache cannot
 * grow without bound across releases.
 */
export function shouldKeepUiUpdateEntry(entry: string, targetFileName: string): boolean {
  return entry === targetFileName || entry.startsWith(`${targetFileName}.part`)
}

export async function pruneUiUpdateCache(dir: string, targetFileName: string): Promise<void> {
  const entries = await readdir(dir).catch(() => [] as string[])
  for (const entry of entries) {
    if (shouldKeepUiUpdateEntry(entry, targetFileName)) continue
    await rm(join(dir, entry), { recursive: true, force: true }).catch(() => {})
  }
}

/** Wait between retry attempts. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Leave a verified installer at `dest`, downloading only what is still missing.
 *
 * The checksum is fetched *before* the download: it is 90 bytes, it decides
 * whether downloading is worth starting at all, and if it cannot be fetched the
 * attempt fails before any bandwidth is spent. After the download the file is
 * hashed for real — the check that matters, because a resumed file is assembled
 * from parts fetched across several attempts.
 */
async function fetchVerifiedInstaller(url: string, dest: string, version: string): Promise<void> {
  const { hash } = await fetchExpectedChecksum(url)

  // Complete already, from an attempt whose only failure was the network? Then
  // re-downloading 210 MB would be absurd.
  if (await fileMatchesChecksum(dest, hash)) {
    appLog.info('updates', `Reusing the installer already staged for ${version}`)
    return
  }

  await downloadToFile(url, dest, (received, total) => {
    const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0
    broadcastUiProgress({
      phase: 'downloading',
      percent,
      receivedBytes: received,
      totalBytes: total,
      version,
    })
  })
  await assertAssetChecksum(url, dest, hash)
}

export async function installUiUpdate(): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  const vespi = await checkVespiUpdate()
  if (!vespi.updateAvailable) return { ok: false, error: 'VesPi is already up to date' }
  if (!vespi.installerUrl) {
    return { ok: false, error: '没有找到 Windows 安装包。请打开 GitHub Release 手动下载。' }
  }
  const fileName = vespiInstallerAssetName(vespi.latestVersion) ?? `VesPi-Setup-${vespi.latestVersion}-win-x64.exe`
  const updateDir = uiUpdateCacheDir()
  const dest = join(updateDir, fileName)
  try {
    broadcastUiProgress({ phase: 'downloading', percent: 0, receivedBytes: 0, totalBytes: 0, version: vespi.latestVersion })
    await pruneUiUpdateCache(updateDir, fileName)

    // Retry the fetch, not the whole update. Because the parts survive, attempt
    // two only pays for the ranges that never arrived — which is what makes three
    // attempts on a flaky link a reasonable thing to do rather than a way to wait
    // three times as long for the same failure.
    let lastError: unknown = null
    for (let attempt = 1; attempt <= UI_UPDATE_ATTEMPTS; attempt++) {
      try {
        await fetchVerifiedInstaller(vespi.installerUrl, dest, vespi.latestVersion)
        lastError = null
        break
      } catch (err) {
        lastError = err
        if (attempt === UI_UPDATE_ATTEMPTS) break
        appLog.warn(
          'updates',
          `Installer fetch attempt ${attempt}/${UI_UPDATE_ATTEMPTS} failed; retrying with the bytes already on disk`,
          err
        )
        // No progress reset here on purpose: the next attempt reports the bytes
        // it resumed from, so the bar visibly continues instead of jumping to 0.
        await delay(attempt * UI_UPDATE_RETRY_DELAY_MS)
      }
    }
    if (lastError !== null) throw lastError

    broadcastUiProgress({ phase: 'installing', percent: 100, receivedBytes: 0, totalBytes: 0, version: vespi.latestVersion })
    // Ordering: this installer ends by restarting the app, so a kernel swap must
    // not be in flight when it runs. The kernel is a local file swap that
    // finishes in milliseconds, so it goes first and this waits for it.
    await updateOrder.waitForKernelApply()
    // The installer rewrites the whole install directory — VesPi.exe and the
    // kernel bundled beside it — so this app must exit for it to finish. Ask
    // before anything is launched: a refusal then costs a cancelled update,
    // not an installer running against an app that will not let go.
    if (!(await confirmInstallerHandover())) {
      return { ok: false, error: '更新已取消：请先保存未保存的改动，然后再试一次。' }
    }
    const opened = await shell.openPath(dest)
    if (opened) throw new Error(opened)
    updateOrder.markUiInstallerLaunched()
    // "done" means the verified installer was launched; installation itself is
    // owned by Windows and can still be cancelled by the user.
    broadcastUiProgress({ phase: 'done', percent: 100, receivedBytes: 0, totalBytes: 0, version: vespi.latestVersion })
    // Quit on purpose, a moment from now: the installer cannot overwrite a
    // running VesPi.exe or its kernel child, and on locked-down machines its own
    // close-the-app step cannot find the latter at all. See installer-handoff.ts.
    beginInstallerHandover()
    return { ok: true, version: vespi.latestVersion }
  } catch (err) {
    appLog.warn('updates', 'VesPi UI installer download or verification failed', err)
    broadcastUiProgress({ phase: 'error', percent: 0, receivedBytes: 0, totalBytes: 0, error: friendlyNetworkError(err) })
    return { ok: false, error: friendlyNetworkError(err) }
  }
  // Nothing is cleaned up on the way out: the staged installer is what the launch
  // above needs, and the part files are what makes the next attempt cheap. Stale
  // versions are pruned at the start of the next update instead.
}

export function registerUpdateHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async (): Promise<UpdateCheckResult> => {
    return checkForUpdate()
  })
  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL_KERNEL, async () => {
    broadcastKernelProgress({ phase: 'checking', percent: 0, receivedBytes: 0, totalBytes: 0 })
    return installKernelUpdate()
  })
  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL_UI, async () => {
    broadcastUiProgress({ phase: 'checking', percent: 0, receivedBytes: 0, totalBytes: 0 })
    return installUiUpdate()
  })
}
