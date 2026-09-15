import type { KernelUpdateProgress } from '../../../shared/ipc-contracts'
import { t, type AppLanguage } from '../../../shared/i18n'

function formatBytes(n: number): string {
  if (n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function kernelUpdateBusy(progress: KernelUpdateProgress | null): boolean {
  return Boolean(progress && progress.phase !== 'done' && progress.phase !== 'error')
}

export interface UpdateRowVisibility {
  ui: boolean
  kernel: boolean
}

/**
 * Which update lines the banner shows.
 *
 * Each channel is decided on its own: its line appears when its release is
 * available, or when its own install has something to report. **Neither depends
 * on the other channel's progress** — the banner used to hide the UI line
 * whenever the kernel was busy, so starting one update made the other vanish.
 * Showing them is independent; only *applying* them is ordered (update-order.ts).
 */
export function visibleUpdateRows(input: {
  uiAvailable: boolean
  kernelAvailable: boolean
  uiProgress: KernelUpdateProgress | null
  kernelProgress: KernelUpdateProgress | null
}): UpdateRowVisibility {
  return {
    ui: input.uiAvailable || input.uiProgress !== null,
    kernel: input.kernelAvailable || input.kernelProgress !== null,
  }
}

export function kernelUpdateLabel(
  language: AppLanguage,
  progress: KernelUpdateProgress | null,
  kind: 'kernel' | 'ui' = 'kernel',
): string {
  const checking = kind === 'ui' ? 'uiUpdateChecking' : 'kernelUpdateChecking'
  const installing = kind === 'ui' ? 'uiUpdateInstalling' : 'kernelUpdateInstalling'
  const failed = kind === 'ui' ? 'uiUpdateFailed' : 'kernelUpdateFailed'
  const done = kind === 'ui' ? 'uiUpdated' : 'kernelUpdated'
  const idle = kind === 'ui' ? 'updatingUi' : 'updatingKernel'
  if (!progress) return t(language, idle)
  if (progress.phase === 'checking') return t(language, checking)
  if (progress.phase === 'installing') return t(language, installing)
  if (progress.phase === 'restarting') return t(language, 'kernelUpdateRestarting')
  if (progress.phase === 'error') return t(language, failed, { error: progress.error ?? '' })
  if (progress.phase === 'done') return t(language, done, { version: progress.version ?? '' })
  const percent = String(progress.percent)
  // The download phase is the longest one for both channels, and these two keys
  // used to be hard-coded to the kernel wording — so a downloading VesPi update
  // announced itself as "downloading the kernel", making both rows read alike.
  const withBytes = kind === 'ui' ? 'uiUpdateDownloadingBytes' : 'kernelUpdateDownloadingBytes'
  const withoutBytes = kind === 'ui' ? 'uiUpdateDownloading' : 'kernelUpdateDownloading'
  if (progress.totalBytes > 0) {
    return t(language, withBytes, {
      percent,
      received: formatBytes(progress.receivedBytes),
      total: formatBytes(progress.totalBytes),
    })
  }
  return t(language, withoutBytes, { percent })
}

export function kernelUpdateBarPercent(progress: KernelUpdateProgress | null): number {
  if (!progress) return 0
  if (progress.phase === 'checking') return 4
  if (progress.phase === 'downloading') return progress.totalBytes > 0 ? Math.max(4, progress.percent) : 12
  if (progress.phase === 'installing' || progress.phase === 'restarting') return 100
  if (progress.phase === 'done') return 100
  return 0
}
