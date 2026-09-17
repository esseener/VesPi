import { ipcMain, app, BrowserWindow, net, session, shell } from 'electron'
import { createWriteStream, createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { chmod, copyFile, mkdir, mkdtemp, rename, rm, unlink } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { tmpdir } from 'os'
import type { KernelUpdateInfo, KernelUpdateProgress, UpdateCheckResult } from '../../shared/ipc-contracts'
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
import { runPiCli } from './run-pi-cli'
import { resolvePrivateOmpPath } from '../vespi-runtime'

const UPDATE_REPO = 'esseener/VesPi'
const KERNEL_REPO = 'can1357/oh-my-pi'
const UPDATE_CHECK_TIMEOUT_MS = 8000
const KERNEL_DOWNLOAD_TIMEOUT_MS = 10 * 60_000
const USER_AGENT = 'VesPi'

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
    return { ...none, checkError: friendlyNetworkError(err) }
  }
}

async function checkKernelUpdate(): Promise<KernelUpdateInfo> {
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
    return {
      updateAvailable: currentVersion ? isNewerVersion(latestVersion, currentVersion) : Boolean(asset),
      currentVersion,
      latestVersion,
      url: latest.html_url,
      downloadUrl: asset?.browser_download_url ?? '',
    }
  } catch (err) {
    appLog.warn('updates', 'OMP kernel update check failed', err)
    return { ...none, checkError: friendlyNetworkError(err) }
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

async function downloadToFile(
  url: string,
  dest: string,
  onProgress?: (received: number, total: number) => void,
): Promise<void> {
  if (!isHttpsUrl(url) || !githubHostAllowed(url)) {
    throw new Error('Download URL is not an allowed GitHub HTTPS host')
  }
  await mkdir(dirname(dest), { recursive: true })
  await new Promise<void>((resolve, reject) => {
    const req = netRequest(url)
    req.setHeader('User-Agent', USER_AGENT)
    req.setHeader('Accept', 'application/octet-stream')
    const timer = setTimeout(() => {
      req.abort()
      reject(new Error('timed out'))
    }, KERNEL_DOWNLOAD_TIMEOUT_MS)
    req.on('response', (res) => {
      if ((res.statusCode ?? 0) >= 400) {
        clearTimeout(timer)
        reject(new Error(`Download failed: ${res.statusCode} ${res.statusMessage ?? ''}`.trim()))
        return
      }
      const total = Number(res.headers['content-length'] ?? 0)
      let received = 0
      onProgress?.(0, total)
      const out = createWriteStream(dest)
      res.on('data', (chunk) => {
        const buf = Buffer.from(chunk)
        received += buf.length
        onProgress?.(received, total)
        out.write(buf)
      })
      res.on('end', () => {
        clearTimeout(timer)
        out.end(() => {
          onProgress?.(received, total || received)
          resolve()
        })
      })
      res.on('error', (err) => {
        clearTimeout(timer)
        out.destroy()
        reject(err)
      })
      out.on('error', (err) => {
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

async function verifyReleaseAsset(downloadUrl: string, filePath: string): Promise<void> {
  const assetName = decodeURIComponent(new URL(downloadUrl).pathname.split('/').pop() ?? '')
  if (!assetName) throw new Error('Release asset URL has no filename')
  const sumsText = (await fetchBytes(checksumUrlForAsset(downloadUrl), UPDATE_CHECK_TIMEOUT_MS)).toString('utf8')
  const expectedHash = parseSha256Sum(sumsText, assetName)
  if (!expectedHash) throw new Error(`SHA256SUMS.txt has no checksum for ${assetName}; refusing to install`)
  const actualHash = await sha256OfFile(filePath)
  if (actualHash !== expectedHash) {
    throw new Error(
      `Checksum mismatch for ${assetName} (expected ${expectedHash.slice(0, 12)}…, got ${actualHash.slice(0, 12)}…); refusing to install`,
    )
  }
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
    appLog.warn('updates', `Installed OMP kernel ${kernel.latestVersion} at ${dest}`)
    broadcastKernelProgress({ phase: 'done', percent: 100, receivedBytes: 0, totalBytes: 0, version: kernel.latestVersion })
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

export async function installUiUpdate(): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  const vespi = await checkVespiUpdate()
  if (!vespi.updateAvailable) return { ok: false, error: 'VesPi is already up to date' }
  if (!vespi.installerUrl) {
    return { ok: false, error: '没有找到 Windows 安装包。请打开 GitHub Release 手动下载。' }
  }
  const fileName = vespiInstallerAssetName(vespi.latestVersion) ?? `VesPi-Setup-${vespi.latestVersion}-win-x64.exe`
  const updateDir = await mkdtemp(join(tmpdir(), 'vespi-update-'))
  const dest = join(updateDir, fileName)
  let openedInstaller = false
  try {
    broadcastUiProgress({ phase: 'downloading', percent: 0, receivedBytes: 0, totalBytes: 0, version: vespi.latestVersion })
    await downloadToFile(vespi.installerUrl, dest, (received, total) => {
      const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0
      broadcastUiProgress({
        phase: 'downloading',
        percent,
        receivedBytes: received,
        totalBytes: total,
        version: vespi.latestVersion,
      })
    })
    broadcastUiProgress({ phase: 'installing', percent: 100, receivedBytes: 0, totalBytes: 0, version: vespi.latestVersion })
    await verifyReleaseAsset(vespi.installerUrl, dest)
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
    openedInstaller = true
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
  } finally {
    if (!openedInstaller) await rm(updateDir, { recursive: true, force: true }).catch(() => {})
  }
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
