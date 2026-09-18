import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, GitCommitHorizontal, GitPullRequest, Loader2, Upload, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useAppStore } from '../store'
import type { GitConveyorStatus } from '../../../shared/ipc-contracts'
import { formatIpcError } from '../utils/ipc-error'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'

type ConveyorDialog =
  | { kind: 'commit'; message: string }
  | { kind: 'pr'; title: string; body: string; base: string }

export function GitConveyorActions({ onChanged }: { onChanged?: () => void }): React.JSX.Element {
  const requestConfirm = useAppStore((state) => state.requestConfirm)
  const language = useAppStore(
    (state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE
  )
  const [status, setStatus] = useState<GitConveyorStatus | null>(null)
  const [busy, setBusy] = useState<'commit' | 'push' | 'pr' | null>(null)
  const [dialog, setDialog] = useState<ConveyorDialog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  // Esc closes the commit/PR dialog — it had no keyboard way out at all.
  useEffect(() => {
    if (!dialog) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (event.isComposing || event.keyCode === 229) return
      event.stopPropagation()
      setDialog(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [dialog])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setStatus(await window.piDesktop.git.status())
      setError(null)
    } catch (err) {
      setStatus(null)
      setError(formatIpcError(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const run = async <T,>(
    kind: 'commit' | 'push' | 'pr',
    action: () => Promise<T>,
    success: (result: T) => string,
  ): Promise<void> => {
    if (busy) return
    setBusy(kind)
    setError(null)
    setFeedback(null)
    try {
      const result = await action()
      setFeedback(success(result))
      await refresh()
      onChanged?.()
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(null)
    }
  }

  const openCommitDialog = (): void => {
    setError(null)
    setDialog({
      kind: 'commit',
      message: status?.lastCommitMessage ?? t(language, 'gitDefaultCommitMessage'),
    })
  }

  const openPrDialog = (): void => {
    if (!status?.branch) {
      setError(t(language, 'gitNeedBranch'))
      return
    }
    if (status.dirtyFiles || status.ahead > 0 || !status.hasUpstream) {
      setError(
        status.dirtyFiles
          ? t(language, 'gitCommitFirst')
          : t(language, 'gitPushFirst')
      )
      return
    }
    setDialog({
      kind: 'pr',
      title: status.lastCommitMessage ?? status.branch,
      body: '## Summary\n\n## Verification\n',
      base: status.baseBranch ?? '',
    })
  }

  const submitDialog = (): void => {
    if (!dialog) return
    if (dialog.kind === 'commit') {
      const message = dialog.message.trim()
      if (!message) {
        setError(t(language, 'gitCommitMessageRequired'))
        return
      }
      setDialog(null)
      void run(
        'commit',
        () => window.piDesktop.git.commit({ message }),
        (next) => t(language, 'gitCommitted', { head: next.head.slice(0, 8) }),
      )
      return
    }

    const title = dialog.title.trim()
    const body = dialog.body.trim()
    if (!title) {
      setError(t(language, 'gitPrTitleRequired'))
      return
    }
    setDialog(null)
    void run(
      'pr',
      async () => {
        const result = await window.piDesktop.git.createPullRequest({
          title,
          body,
          ...(dialog.base.trim() ? { base: dialog.base.trim() } : {}),
        })
        if (result.url) void window.piDesktop.system.openExternal(result.url)
        return result
      },
      (result) =>
        result.url
          ? t(language, 'gitPrCreated', { url: result.url })
          : t(language, 'gitPrCreatedPlain'),
    )
  }

  const push = async (): Promise<void> => {
    if (!status) return
    if (status.dirtyFiles) {
      setError(t(language, 'gitCommitWorkingTreeFirst'))
      return
    }
    const target = status.upstreamBranch
      ? `${status.pushRemote ?? 'remote'}/${status.upstreamBranch}`
      : `${status.pushRemote ?? 'origin'}/${status.branch ?? 'current branch'}`
    const confirmed = await requestConfirm({
      title: t(language, 'gitPushTitle'),
      message: t(language, 'gitPushMessage', {
        branch: status.branch ?? 'the current branch',
        target,
      }),
      confirmLabel: t(language, 'gitPush'),
      cancelLabel: t(language, 'cancel'),
      danger: true,
    })
    if (!confirmed) return
    void run(
      'push',
      () => window.piDesktop.git.push(),
      (next) =>
        next.ahead > 0
          ? t(language, 'gitPushedCommits', { count: String(next.ahead) })
          : t(language, 'gitBranchPushed'),
    )
  }

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-1.5 lg:justify-end">
        {status && (
          <span className="basis-full mr-1 max-w-60 truncate text-[10px] text-faint sm:basis-auto" title={status.branch ?? undefined}>
            {status.branch ?? t(language, 'gitDetached')}
            {status.dirtyFiles > 0
              ? ` ${t(language, 'gitChangedCount', { count: String(status.dirtyFiles) })}`
              : ''}
          </span>
        )}
        <button type="button" onClick={openCommitDialog} disabled={busy !== null || !status?.dirtyFiles} className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted transition-colors hover:bg-surface-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-40" title={t(language, 'gitCommitTooltip')}>
          {busy === 'commit' ? <Loader2 size={11} className="animate-spin" /> : <GitCommitHorizontal size={11} />}
          {t(language, 'gitCommit')}
        </button>
        <button type="button" onClick={() => void push()} disabled={busy !== null || !status || !!status.dirtyFiles || !status.branch} className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted transition-colors hover:bg-surface-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-40" title={t(language, 'gitPushTooltip')}>
          {busy === 'push' ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
          {t(language, 'gitPush')}
        </button>
        <button type="button" onClick={openPrDialog} disabled={busy !== null || !status || !!status.dirtyFiles || !!status.ahead || !status.branch || !status.hasUpstream} className={clsx('flex shrink-0 items-center gap-1 rounded border border-accent/50 px-2 py-1 text-[10px] text-accent-fg transition-colors hover:bg-accent-bg/20 disabled:cursor-not-allowed disabled:opacity-40')} title={t(language, 'gitPrTooltip')}>
          {busy === 'pr' ? <Loader2 size={11} className="animate-spin" /> : <GitPullRequest size={11} />}
          {t(language, 'gitPr')}
        </button>
        {status?.remoteUrl && <ExternalLink size={11} className="text-faint" aria-hidden="true" />}
        {(error || feedback) && <span className={clsx('basis-full truncate text-[10px]', error ? 'text-error' : 'text-success')} role="status" title={error ?? feedback ?? undefined}>{error ?? feedback}</span>}
      </div>
      {dialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
          role="presentation"
          onMouseDown={(event) => {
            // The backdrop previously did nothing: clicking beside the dialog was
            // indistinguishable from a dead click. Only react to the backdrop
            // itself, never to a press that started inside the form.
            if (event.target === event.currentTarget) setDialog(null)
          }}
        >
          <form
            className="w-full max-w-lg surface-floating p-4 shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault()
              submitDialog()
            }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-primary">{t(language, dialog.kind === 'commit' ? 'gitCommitDialogTitle' : 'gitPrDialogTitle')}</h2>
              <button type="button" onClick={() => setDialog(null)} className="rounded p-1 text-muted hover:bg-surface-hover hover:text-primary" aria-label={t(language, 'close')}>
                <X size={14} />
              </button>
            </div>
            {dialog.kind === 'commit' ? (
              <label className="block text-xs text-muted">
                {t(language, 'gitCommitMessage')}
                <input
                  autoFocus
                  value={dialog.message}
                  onChange={(event) => setDialog({ ...dialog, message: event.target.value })}
                  className="mt-1 w-full rounded border border-border-strong bg-app px-2 py-1.5 text-sm text-primary outline-none focus:border-focus"
                />
              </label>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs text-muted">
                  {t(language, 'gitPrTitle')}
                  <input
                    autoFocus
                    value={dialog.title}
                    onChange={(event) => setDialog({ ...dialog, title: event.target.value })}
                    className="mt-1 w-full rounded border border-border-strong bg-app px-2 py-1.5 text-sm text-primary outline-none focus:border-focus"
                  />
                </label>
                <label className="block text-xs text-muted">
                  {t(language, 'gitPrBaseBranch')}
                  <input
                    value={dialog.base}
                    onChange={(event) => setDialog({ ...dialog, base: event.target.value })}
                    placeholder={t(language, 'gitPrBasePlaceholder')}
                    className="mt-1 w-full rounded border border-border-strong bg-app px-2 py-1.5 text-sm text-primary outline-none focus:border-focus"
                  />
                </label>
                <label className="block text-xs text-muted">
                  {t(language, 'gitPrDescription')}
                  <textarea
                    value={dialog.body}
                    onChange={(event) => setDialog({ ...dialog, body: event.target.value })}
                    rows={7}
                    className="mt-1 w-full resize-y rounded border border-border-strong bg-app px-2 py-1.5 text-sm text-primary outline-none focus:border-focus"
                  />
                </label>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setDialog(null)} className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-primary">{t(language, 'cancel')}</button>
              <button type="submit" className="rounded-md border border-border-strong bg-transparent px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent-fg hover:text-primary">{t(language, dialog.kind === 'commit' ? 'gitCommit' : 'gitCreatePr')}</button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
