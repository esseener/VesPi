import { ipcMain, app } from 'electron'
import { createWriteStream } from 'fs'
import { chmod, copyFile, mkdir, rename, unlink } from 'fs/promises'
import { dirname } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import type { KernelUpdateInfo, UpdateCheckResult } from '../../shared/ipc-contracts'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { appLog } from '../app-log'
import { extractVersionLine } from '../diagnostics-report'
import { runPiCli } from './run-pi-cli'
import { resolvePrivateOmpPath } from '../vespi-runtime'

const UPDATE_REPO = 'esseener/VesPi'
const KERNEL_REPO = 'can1357/oh-my-pi'
const UPDATE_CHECK_TIMEOUT_MS = 8000
const KERNEL_DOWNLOAD_TIMEOUT_MS = 120_000
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

export function ompAssetName(platform = process.platform, arch = process.arch): string {
  if (platform === 'win32') return arch === 'arm64' ? 'omp-windows-arm64.exe' : 'omp-windows-x64.exe'
  if (platform === 'darwin') return arch === 'arm64' ? 'omp-darwin-arm64' : 'omp-darwin-x64'
  if (arch === 'arm64') return 'omp-linux-arm64'
  return 'omp-linux-x64'
}

function emptyKernel(currentVersion: string): KernelUpdateInfo {
  return { updateAvailable: false, currentVersion, latestVersion: currentVersion, url: '', downloadUrl: '' }
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return await res.json() as T
  } finally {
    clearTimeout(timer)
  }
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
    return {
      updateAvailable: isNewerVersion(latestVersion, currentVersion),
      currentVersion,
      latestVersion,
      url: latest.html_url,
      name: latest.name ?? latest.tag_name,
    }
  } catch (err) {
    appLog.warn('updates', 'VesPi update check failed', err)
    return none
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
    return none
  }
}

async function checkForUpdate(): Promise<UpdateCheckResult> {
  const [vespi, kernel] = await Promise.all([checkVespiUpdate(), checkKernelUpdate()])
  return { ...vespi, kernel }
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), KERNEL_DOWNLOAD_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/octet-stream' },
      signal: controller.signal,
      redirect: 'follow',
    })
    if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
    await mkdir(dirname(dest), { recursive: true })
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest))
  } finally {
    clearTimeout(timer)
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
  try {
    await downloadToFile(kernel.downloadUrl, staged)
    try { await unlink(backup) } catch { /* no previous backup */ }
    try {
      await rename(dest, backup)
    } catch {
      await copyFile(dest, backup)
      await unlink(dest)
    }
    try {
      await rename(staged, dest)
    } catch {
      await copyFile(staged, dest)
      await unlink(staged)
    }
    if (process.platform !== 'win32') await chmod(dest, 0o755)
    appLog.warn('updates', `Installed OMP kernel ${kernel.latestVersion} at ${dest}`)
    return { ok: true, version: kernel.latestVersion }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    appLog.warn('updates', 'OMP kernel install failed', err)
    try { await unlink(staged) } catch { /* ignore */ }
    return { ok: false, error: message }
  }
}

export function registerUpdateHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.UPDATE_CHECK, async (): Promise<UpdateCheckResult> => {
    return checkForUpdate()
  })
  ipcMain.handle(IPC_CHANNELS.UPDATE_INSTALL_KERNEL, async () => {
    return installKernelUpdate()
  })
}
