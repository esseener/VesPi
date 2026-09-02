import { useCallback, useEffect, useState } from 'react'
import { Info, Loader2, ArrowUpCircle } from 'lucide-react'
import { useAppStore } from '../store'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import type { DiagnosticsReport } from '../../../shared/ipc-contracts'
import vespiCenterLogo from '../assets/vespi-center-logo.png'

function platformLabel(platform: string | undefined, arch: string | undefined): string {
  if (!platform) return '—'
  const os =
    platform === 'win32' ? 'Windows' :
    platform === 'darwin' ? 'macOS' :
    platform === 'linux' ? 'Linux' :
    platform
  const chip =
    arch === 'x64' ? 'x64' :
    arch === 'arm64' ? 'ARM64' :
    arch ?? ''
  return chip ? `${os} ${chip}` : os
}

function kernelLabel(version: string | null | undefined): string {
  const ver = version?.trim()
  return ver ? `Oh My Pi ${ver}` : 'Oh My Pi'
}

export function AboutPanel(): React.JSX.Element {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const updateInfo = useAppStore((state) => state.updateInfo)
  const checkForUpdates = useAppStore((state) => state.checkForUpdates)
  const installKernelUpdate = useAppStore((state) => state.installKernelUpdate)
  const [report, setReport] = useState<DiagnosticsReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [kernelMessage, setKernelMessage] = useState<string | null>(null)
  const [kernelError, setKernelError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setReport(await window.piDesktop.diagnostics.get())
    } catch {
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (updateInfo) {
      setChecked(true)
      return
    }
    let cancelled = false
    setChecking(true)
    void checkForUpdates().finally(() => {
      if (cancelled) return
      setChecked(true)
      setChecking(false)
    })
    return () => {
      cancelled = true
    }
  }, [checkForUpdates, updateInfo])

  const uiVersion = report?.app.version ?? '—'
  const ompVersion = updateInfo?.kernel.currentVersion || report?.piVersion?.trim() || '—'

  const handleCheck = async (): Promise<void> => {
    setChecking(true)
    setKernelMessage(null)
    setKernelError(null)
    try {
      await checkForUpdates()
      setChecked(true)
    } finally {
      setChecking(false)
    }
  }

  const handleInstallKernel = async (): Promise<void> => {
    setInstalling(true)
    setKernelMessage(null)
    setKernelError(null)
    try {
      const result = await installKernelUpdate()
      if (result.ok) {
        setKernelMessage(t(language, 'kernelUpdated', { version: result.version }))
        await load()
      } else {
        setKernelError(t(language, 'kernelUpdateFailed', { error: result.error }))
      }
    } finally {
      setInstalling(false)
    }
  }
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Info size={16} className="text-muted" />
        <h2 className="text-sm font-medium text-primary">{t(language, 'about')}</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-lg space-y-6">
          <div className="flex flex-col items-center text-center">
            <img src={vespiCenterLogo} alt={t(language, 'appName')} draggable={false} className="h-12 w-auto max-w-[18rem]" />
            <p className="mt-3 text-xs text-dim">{t(language, 'aboutSubtitle')}</p>
          </div>

          {loading && !report ? (
            <div className="flex justify-center py-8">
              <Loader2 size={18} className="animate-spin text-dim" />
            </div>
          ) : (
            <div className="space-y-px border border-border">
              <AboutRow label={t(language, 'aboutUi')} value={`VesPi ${uiVersion}`} />
              <AboutRow label={t(language, 'aboutKernel')} value={kernelLabel(report?.piVersion)} />
              <AboutRow label={t(language, 'aboutPlatform')} value={platformLabel(report?.app.platform, report?.app.arch)} />
            </div>
          )}

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void handleCheck()}
              disabled={checking || installing}
              className="flex w-full items-center justify-center gap-2 border border-border-strong bg-transparent px-3 py-2 text-sm text-muted transition-colors hover:border-accent-fg hover:text-primary disabled:opacity-60"
            >
              {checking ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpCircle size={14} />}
              {checking ? t(language, 'checkingUpdates') : t(language, 'checkUpdates')}
            </button>
            <p className="text-[11px] text-faint">{t(language, 'updateOmpHint')}</p>
            {updateInfo?.updateAvailable && (
              <button
                type="button"
                onClick={() => window.piDesktop.system.openExternal(updateInfo.url)}
                className="flex w-full items-center gap-2 border border-accent-fg/60 bg-transparent px-3 py-2 text-left text-sm text-primary transition-colors hover:border-accent-fg"
              >
                <ArrowUpCircle size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {t(language, 'updateHasUpdate')} · {t(language, 'updateAvailable', { latest: `v${updateInfo.latestVersion}`, current: `v${updateInfo.currentVersion}` })}
                </span>
                <span className="shrink-0 text-xs text-dim">{t(language, 'updateOpenRelease')}</span>
              </button>
            )}
            {updateInfo?.kernel.updateAvailable && (
              <button
                type="button"
                onClick={() => void handleInstallKernel()}
                disabled={installing || !updateInfo.kernel.downloadUrl}
                className="flex w-full items-center gap-2 border border-border-strong bg-transparent px-3 py-2 text-left text-sm text-muted transition-colors hover:border-accent-fg hover:text-primary disabled:opacity-60"
              >
                {installing ? <Loader2 size={14} className="shrink-0 animate-spin" /> : <ArrowUpCircle size={14} className="shrink-0" />}
                <span className="min-w-0 flex-1 truncate">
                  {installing
                    ? t(language, 'updatingKernel')
                    : t(language, 'kernelUpdateAvailable', { latest: `v${updateInfo.kernel.latestVersion}`, current: `v${updateInfo.kernel.currentVersion || ompVersion}` })}
                </span>
                <span className="shrink-0 text-xs text-dim">{t(language, 'updateKernel')}</span>
              </button>
            )}
            {kernelMessage && <p className="text-xs text-success">{kernelMessage}</p>}
            {kernelError && <p className="text-xs text-error">{kernelError}</p>}
            {checked && updateInfo && !updateInfo.updateAvailable && !updateInfo.kernel.updateAvailable && (
              <p className="text-xs text-dim">
                {t(language, 'updateCurrent', { vespi: updateInfo.currentVersion || uiVersion, omp: updateInfo.kernel.currentVersion || ompVersion })}
              </p>
            )}
            {checked && !updateInfo && (
              <p className="text-xs text-error">{t(language, 'updateCheckFailed')}</p>
            )}
          </div>
          <p className="text-center text-[11px] tracking-wide text-faint">{t(language, 'poweredBy')}</p>
        </div>
      </div>
    </div>
  )
}

function AboutRow({
  label,
  value,
}: {
  label: string
  value: string
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border px-3 py-2 last:border-b-0">
      <span className="shrink-0 text-[11px] uppercase tracking-[0.14em] text-faint">{label}</span>
      <span className="min-w-0 truncate text-right text-xs text-secondary" title={value}>
        {value}
      </span>
    </div>
  )
}
