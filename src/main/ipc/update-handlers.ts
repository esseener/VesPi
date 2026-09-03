import { ipcMain, app, BrowserWindow, net, session, shell } from 'electron'
import { createWriteStream, createReadStream } from 'fs'
import { createHash } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { chmod, copyFile, mkdir, rename, unlink } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { tmpdir } from 'os'
import type { KernelUpdateInfo, KernelUpdateProgress, UpdateCheckResult } from '../../shared/ipc-contracts'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { appLog } from '../app-log'
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
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i]
  }
  if (a.pre === b.pre) return false
  if (!a.pre) return true
  if (!b.pre) return false
  return a.pre > b.pre
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

function pickLatestRelease(releases: GithubRelease[]): GithubRelease | null {
  const published = releases.filter((r) => !r.draft)
  if (published.length === 0) return null
  let latest = published[0]
  for (const r of published) {
    if (isNewerVersion(r.tag_name.replace(/^v/, ''), latest.tag_name.replace(/^v/, ''))) latest = r
  }
  return latest
}

async function currentOmpVersion(): Promise<string> {
  const cwd = process.env.HOME ?? process.env.USERPROFILE ?? process.cwd()
  const result = await runPiCli(['--version'], cwd, 8_000)
  if (!result.success) return ''
  const line = extractVersionLine(result.output)
  if (!line) return ''
  const match = line.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/)
  return match?.[1] ?? line
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

export async function installKernelUpdate(): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
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

    // Fingerprint: the release's own SHA256SUMS.txt is the integrity anchor.
    // Same HTTPS/GitHub origin as the binary, but a different asset — catches
    // truncated/corrupted downloads and a swapped binary on a cached mirror.
    const assetName = kernel.downloadUrl.slice(kernel.downloadUrl.lastIndexOf('/') + 1)
    const sumsUrl = `${kernel.downloadUrl.slice(0, kernel.downloadUrl.lastIndexOf('/') + 1)}SHA256SUMS.txt`
    broadcastKernelProgress({ phase: 'installing', percent: 100, receivedBytes: 0, totalBytes: 0, version: kernel.latestVersion })
    const sumsText = (await fetchBytes(sumsUrl, UPDATE_CHECK_TIMEOUT_MS)).toString('utf8')
    const expectedHash = parseSha256Sum(sumsText, assetName)
    if (!expectedHash) throw new Error(`SHA256SUMS.txt has no checksum for ${assetName}; refusing to install`)
    const actualHash = await sha256OfFile(staged)
    if (actualHash !== expectedHash) {
      throw new Error(`Kernel checksum mismatch (expected ${expectedHash.slice(0, 12)}…, got ${actualHash.slice(0, 12)}…); refusing to install`)
    }

    // Health check: the staged binary must run, and it must report the very
    // version we asked for. Only then is the current kernel moved aside.
    const stagedVersion = await probeBinaryVersion(staged)
    if (stagedVersion === null) throw new Error('New kernel failed its startup health check; keeping the current version')
    if (stagedVersion && !sameVersion(stagedVersion, kernel.latestVersion)) {
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
  const dest = join(tmpdir(), fileName)
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
    const opened = await shell.openPath(dest)
    if (opened) throw new Error(opened)
    broadcastUiProgress({ phase: 'done', percent: 100, receivedBytes: 0, totalBytes: 0, version: vespi.latestVersion })
    return { ok: true, version: vespi.latestVersion }
  } catch (err) {
    appLog.warn('updates', 'VesPi UI installer download failed', err)
    broadcastUiProgress({ phase: 'error', percent: 0, receivedBytes: 0, totalBytes: 0, error: friendlyNetworkError(err) })
    return { ok: false, error: friendlyNetworkError(err) }
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
