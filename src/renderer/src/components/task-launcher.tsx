import { useEffect, useRef, useState } from 'react'
import { GitBranch, Layers, Play, X } from 'lucide-react'
import { useAppStore } from '../store'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import { ThemedSelect } from './themed-select'

export function TaskLauncher(): React.JSX.Element | null {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const open = useAppStore((state) => state.taskLauncherOpen)
  const setOpen = useAppStore((state) => state.setTaskLauncherOpen)
  const workspaces = useAppStore((state) => state.workspaces)
  const activeWorkspace = useAppStore((state) => state.activeWorkspace)
  const launchTask = useAppStore((state) => state.launchTask)
  const [workspaceId, setWorkspaceId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [isolated, setIsolated] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const state = useAppStore.getState()
    setWorkspaceId(state.activeWorkspace?.id ?? state.workspaces[0]?.id ?? '')
    setPrompt('')
    setIsolated(false)
    // The focus lands a frame later, once the dialog is in the DOM; drop the
    // pending frame if the dialog closes or unmounts before it runs.
    const focusFrame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(focusFrame)
  }, [open])

  useEffect(() => {
    if (!open) return
    setWorkspaceId((current) => {
      if (current && workspaces.some((workspace) => workspace.id === current)) return current
      return activeWorkspace?.id ?? workspaces[0]?.id ?? ''
    })
  }, [open, activeWorkspace?.id, workspaces])

  if (!open) return null

  const close = (): void => {
    if (!busy) setOpen(false)
  }

  const submit = async (): Promise<void> => {
    if (!workspaceId || !prompt.trim() || busy) return
    setBusy(true)
    const launched = await launchTask({ workspaceId, prompt, isolated })
    setBusy(false)
    if (launched) setOpen(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
      role="presentation"
    >
      <section
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-launcher-title"
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <Play size={16} className="text-accent-fg" />
              <h2 id="task-launcher-title" className="text-sm font-semibold text-primary">{t(language, 'taskLauncherTitle')}</h2>
            </div>
            <p className="mt-1 text-xs text-dim">{t(language, 'taskLauncherSubtitle')}</p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded p-1 text-faint transition-colors hover:bg-surface-hover hover:text-primary disabled:opacity-50"
            aria-label={t(language, 'taskLauncherClose')}
          >
            <X size={15} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-secondary">{t(language, 'taskLauncherProject')}</span>
            <span className="flex items-center gap-2 rounded-md border border-border bg-app px-3 py-2">
              <Layers size={14} className="shrink-0 text-muted" />
              <ThemedSelect
                value={workspaceId}
                onChange={setWorkspaceId}
                disabled={busy || workspaces.length === 0}
                className="min-w-0 flex-1"
                options={
                  workspaces.length === 0
                    ? [{ value: '', label: t(language, 'taskLauncherOpenProjectFirst') }]
                    : workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name }))
                }
              />
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-secondary">{t(language, 'taskLauncherTask')}</span>
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void submit()
                }
              }}
              placeholder={t(language, 'taskLauncherPlaceholder')}
              rows={6}
              disabled={busy}
              className="w-full resize-y rounded-md border border-border bg-app px-3 py-2 text-sm leading-relaxed text-primary outline-none placeholder:text-faint focus:border-focus"
            />
          </label>

          <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-app/50 px-3 py-2.5">
            <input
              type="checkbox"
              checked={isolated}
              onChange={(event) => setIsolated(event.target.checked)}
              disabled={busy}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span className="flex min-w-0 items-start gap-2">
              <GitBranch size={14} className="mt-0.5 shrink-0 text-special" />
              <span>
                <span className="block text-xs font-medium text-secondary">{t(language, 'taskLauncherIsolated')}</span>
                <span className="mt-0.5 block text-[11px] text-faint">{t(language, 'taskLauncherIsolatedHint')}</span>
              </span>
            </span>
          </label>

          <p className="text-[11px] text-faint">
            {t(language, 'taskLauncherHint')}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-app/40 px-5 py-3">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-primary disabled:opacity-50"
          >
            {t(language, 'taskLauncherCancel')}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !workspaceId || !prompt.trim()}
            className="flex items-center gap-1.5 rounded-md border border-border-strong bg-transparent px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-accent-fg hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play size={12} />
            {busy ? t(language, 'taskLauncherStarting') : t(language, 'taskLauncherStart')}
          </button>
        </div>
      </section>
    </div>
  )
}
