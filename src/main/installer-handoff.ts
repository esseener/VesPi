import { execFile } from 'node:child_process'

// Handing the running app over to the Windows installer.
//
// The UI update is not electron-updater: the app downloads the NSIS package
// itself, checks it against the release checksum manifest, and opens it (see
// ipc/update-handlers.ts). From that moment the installer owns the install
// directory, which means rewriting VesPi.exe *and* the 154 MB kernel bundled at
// `resources/runtime/omp/omp.exe` — and neither is writable while something
// still holds it. Nothing used to ask the app to let go: it launched the
// installer and kept running. The installer's own close-the-app step (see
// electron-builder's CHECK_APP_RUNNING) matches on image name where PowerShell
// is unavailable, so an orphaned kernel goes unnoticed, and its file copy gives
// up after five retries onto an "app cannot be closed" dialog whose Retry loops
// forever. That is the reported symptom: the install stopping part-way through
// on one machine and completing on another with the very same package.
//
// So the app now leaves on its own once the installer is up: stop the kernel
// (a child process — on Windows killing the parent leaves it running with the
// bundled binary still open), persist what a hard exit would drop, then go. The
// order is the whole point, so it lives here rather than inline in the update
// handler: testable without downloading or installing anything, the same
// reason update-order.ts exists next to it.

export interface InstallerHandoffDeps {
  /** Ask the user whether the app may quit now. False cancels the handover. */
  confirmQuit: () => Promise<boolean>
  /** Mark a real quit, so a window close stops hiding to the tray. */
  markQuitting: () => void
  /** Drop the tray icon — it would otherwise outlive the process. */
  releaseTray: () => void
  /** Stop the kernel and anything else holding files in the install directory. */
  stopKernel: () => Promise<void>
  /**
   * Persist buffered state and drop the kernel's temp directory. A hard exit
   * skips the before-quit handler that normally does this.
   */
  beforeExit: () => void
  /** Leave the process. */
  exit: (code: number) => void
  /** Progress notes, so a stalled install has a trail in the app log. */
  log: (message: string, detail?: unknown) => void
}

/**
 * How long the installer gets to show its window before the app disappears.
 * It was started by us and needs its own UI up before the app it replaces
 * vanishes; quitting on the same tick can leave the user with nothing on screen
 * while a 207 MB package unpacks in the background.
 */
export const INSTALLER_HANDOVER_DELAY_MS = 2_000

const KERNEL_PROCESS_NAME = 'omp.exe'
/** Grace for the app's own shutdown path before the hard sweep runs. */
const SWEEP_GRACE_MS = 800
/** How long the hard sweep waits for the kernel to actually disappear. */
const SWEEP_TIMEOUT_MS = 5_000
const SWEEP_POLL_MS = 250

let deps: InstallerHandoffDeps | null = null
let handoverStarted = false

export function setupInstallerHandoff(injected: InstallerHandoffDeps): void {
  deps = injected
}

/**
 * Whether the app may quit for the installer. Asked *before* anything is
 * launched, so a refusal costs only a cancelled update instead of leaving the
 * user with an installer running against an app that will not exit.
 */
export async function confirmInstallerHandover(): Promise<boolean> {
  if (!deps) return false
  return await deps.confirmQuit()
}

/**
 * Arm the handover. Called once the installer process has been started; a
 * second call (double-clicked banner, retried update) is a no-op.
 */
export function beginInstallerHandover(delayMs = INSTALLER_HANDOVER_DELAY_MS): void {
  const wired = deps
  if (!wired || handoverStarted) return
  handoverStarted = true
  setTimeout(() => {
    void runInstallerHandover(wired)
  }, delayMs)
}

/**
 * The handover itself. Never throws and never gives up: leaving is the point,
 * so a kernel that refuses to stop is logged and stepped over rather than being
 * allowed to keep the app alive — that would reproduce the stall this exists to
 * fix.
 */
export async function runInstallerHandover(wired: InstallerHandoffDeps): Promise<void> {
  wired.log('Installer launched; quitting so it can rewrite the install directory')
  // First, so a close arriving during the handover cannot hide the window to
  // the tray and keep the app alive behind the installer.
  wired.markQuitting()
  wired.releaseTray()

  try {
    await wired.stopKernel()
  } catch (err) {
    wired.log('Could not stop the kernel before handing over to the installer', err)
  }

  try {
    wired.beforeExit()
  } catch (err) {
    wired.log('Could not flush state before handing over to the installer', err)
  }

  wired.log('Leaving the process for the installer')
  wired.exit(0)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true }, (_err, stdout) => {
      // A missing process makes these tools exit non-zero; only stdout matters.
      resolve(typeof stdout === 'string' ? stdout : '')
    })
  })
}

/**
 * Whether a kernel process is alive that could hold the bundled binary.
 *
 * `tasklist` prints a localized "no tasks match" line when nothing is found, so
 * this looks for the image name instead of trusting the exit code.
 */
export async function kernelProcessAlive(platform: NodeJS.Platform = process.platform): Promise<boolean> {
  if (platform !== 'win32') return false
  const stdout = await runCommand(
    'tasklist',
    ['/FI', `IMAGENAME eq ${KERNEL_PROCESS_NAME}`, '/FO', 'CSV', '/NH'],
    4_000,
  )
  return stdout.toLowerCase().includes(KERNEL_PROCESS_NAME)
}

/**
 * Windows: force-kill a kernel process that outlived the app's own shutdown,
 * then confirm it is gone. Returns whether the install directory looks free.
 *
 * Matched by image name on purpose. The binary is private to VesPi — shipped at
 * `resources/runtime/omp/omp.exe`, never on PATH — and the app holds a
 * single-instance lock, so a name match is our kernel rather than a stranger's.
 * Filtering by executable path the way the installer does needs PowerShell/WMI,
 * which is exactly what is unavailable on the locked-down machines where these
 * installs stall. `/T` walks the subagents OMP spawns under the kernel; `/F`
 * because they own no window to receive a WM_CLOSE.
 */
export async function sweepSurvivingKernel(
  options: { platform?: NodeJS.Platform; graceMs?: number; timeoutMs?: number } = {},
): Promise<boolean> {
  const platform = options.platform ?? process.platform
  // POSIX: the app's own shutdown already signals the whole process group plus
  // the subagents it enumerated before signalling.
  if (platform !== 'win32') return true

  await delay(options.graceMs ?? SWEEP_GRACE_MS)
  if (await kernelProcessAlive(platform)) {
    await runCommand('taskkill', ['/IM', KERNEL_PROCESS_NAME, '/T', '/F'], 5_000)
  }

  const deadline = Date.now() + (options.timeoutMs ?? SWEEP_TIMEOUT_MS)
  while (Date.now() < deadline) {
    if (!(await kernelProcessAlive(platform))) return true
    await delay(SWEEP_POLL_MS)
  }
  return !(await kernelProcessAlive(platform))
}
