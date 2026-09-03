import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Check, ChevronDown, FolderOpen, Layers } from 'lucide-react'
import { useAppStore } from '../store'
import type { Workspace } from '../../../shared/ipc-contracts'
import { workspaceNameFromFolderPath } from '../../../shared/folder-drop'
import { pathsEqual } from '../../../shared/path-compare'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'

/**
 * Compact project picker for the empty-chat center prompt.
 * Follows the active workspace (or the most recent one before boot finishes);
 * supports No project → home directory.
 */
export function ChatProjectPicker(): React.JSX.Element {
  const language = useAppStore((s) => s.settingsDraft.language ?? s.settings?.language ?? DEFAULT_LANGUAGE)
  const workspaces = useAppStore((s) => s.workspaces)
  const activeWorkspace = useAppStore((s) => s.activeWorkspace)
  const activateWorkspace = useAppStore((s) => s.activateWorkspace)
  const createWorkspace = useAppStore((s) => s.createWorkspace)
  const startPi = useAppStore((s) => s.startPi)

  const sorted = useMemo(
    () => [...workspaces].sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    [workspaces]
  )

  // The picker mirrors the app's real project. Before workspaces hydrate
  // (activeWorkspace still null on boot) fall back to the most recent entry so
  // the row never lies with a stale "No project".
  const selected: Workspace | null =
    activeWorkspace ?? sorted[0] ?? null

  const [pickerOpen, setPickerOpen] = useState(false)
  const [homePath, setHomePath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void window.piDesktop.system.getPath('home').then((p) => {
      if (!cancelled) setHomePath(p)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!pickerOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickerOpen])

  const ensureHomeWorkspace = async (): Promise<Workspace | null> => {
    const home = homePath ?? (await window.piDesktop.system.getPath('home'))
    if (!homePath) setHomePath(home)
    const existing = useAppStore.getState().workspaces.find((w) => pathsEqual(w.path, home))
    if (existing) return existing
    await createWorkspace('Home', home)
    return useAppStore.getState().workspaces.find((w) => pathsEqual(w.path, home)) ?? null
  }

  const applySelection = async (id: string | null): Promise<void> => {
    setPickerOpen(false)
    setBusy(true)
    try {
      let targetId = id
      if (!targetId) {
        const homeWs = await ensureHomeWorkspace()
        targetId = homeWs?.id ?? null
      }
      if (targetId && !(await activateWorkspace(targetId))) return
      if (useAppStore.getState().piStatus !== 'running') {
        await startPi()
      }
    } catch {
      // Activation failed; the picker keeps mirroring the real workspace.
    } finally {
      setBusy(false)
    }
  }

  const openFolder = async (): Promise<void> => {
    const path = await window.piDesktop.system.openDialog({ title: t(language, 'openFolderDialog') })
    if (!path) return
    setBusy(true)
    try {
      let ws = useAppStore.getState().workspaces.find((w) => pathsEqual(w.path, path))
      if (!ws) {
        await createWorkspace(workspaceNameFromFolderPath(path), path)
        ws = useAppStore.getState().workspaces.find((w) => pathsEqual(w.path, path))
      }
      if (ws) await applySelection(ws.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={pickerRef}
      className={clsx('relative mt-1.5 flex justify-start px-1.5', busy && 'pointer-events-none opacity-60')}
    >
      <button
        type="button"
        onClick={() => setPickerOpen((o) => !o)}
        disabled={busy}
        className="flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-secondary hover:bg-highlight-strong transition-colors disabled:opacity-50"
        title={selected?.path ?? homePath ?? t(language, 'noProjectHome')}
      >
        {selected ? (
          <Layers size={14} className="shrink-0 text-secondary" />
        ) : (
          <Layers size={14} className="shrink-0 text-faint" />
        )}
        <span className={clsx('min-w-0 truncate font-medium', selected ? 'text-primary' : 'text-dim')}>
          {selected?.name ?? t(language, 'noProject')}
        </span>
        <ChevronDown
          size={12}
          className={clsx('shrink-0 text-dim transition-transform', pickerOpen && 'rotate-180')}
        />
      </button>

      {pickerOpen && (
        <div className="absolute left-1.5 top-full z-30 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-border-strong bg-surface py-1 shadow-xl shadow-black/40">
          <button
            type="button"
            onClick={() => void applySelection(null)}
            className={clsx(
              'flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-hover transition-colors',
              !!homePath && !!activeWorkspace && pathsEqual(activeWorkspace.path, homePath) && 'bg-card'
            )}
          >
            <Layers size={13} className="shrink-0 text-faint" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-primary">{t(language, 'noProject')}</div>
              <div className="truncate text-[11px] text-faint">{homePath ?? t(language, 'homeDirectory')}</div>
            </div>
            {!!homePath && !!activeWorkspace && pathsEqual(activeWorkspace.path, homePath) && (
              <Check size={12} className="shrink-0 text-success" />
            )}
          </button>
          {sorted.length > 0 && <div className="my-1 border-t border-border" />}
          {sorted.map((ws) => (
            <button
              key={ws.id}
              type="button"
              onClick={() => void applySelection(ws.id)}
              className={clsx(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-surface-hover transition-colors',
                ws.id === selected?.id && 'bg-card'
              )}
            >
              <Layers size={13} className="shrink-0 text-secondary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-primary">{ws.name}</div>
                <div className="truncate text-[11px] text-faint">{ws.path}</div>
              </div>
              {ws.id === selected?.id && <Check size={12} className="shrink-0 text-success" />}
            </button>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            onClick={() => void openFolder()}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-secondary hover:bg-surface-hover transition-colors"
          >
            <FolderOpen size={13} className="shrink-0 text-muted" />
            {t(language, 'openFolder')}
          </button>
        </div>
      )}
    </div>
  )
}
