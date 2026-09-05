import { useState, useMemo, useEffect, useRef, useLayoutEffect } from 'react'
import { clsx } from 'clsx'
import { StickyNote } from 'lucide-react'
import { useAppStore } from '../store'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'

const GLOBAL_SCOPE = 'global'

/**
 * Compact picker anchored to the composer note button. Inserts a saved note
 * into the chat input. Opened via the input button or Ctrl+Shift+N.
 */
export function NotePicker(): React.JSX.Element | null {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const open = useAppStore((state) => state.notePickerOpen)
  const notes = useAppStore((state) => state.notes)
  const activeWorkspace = useAppStore((state) => state.activeWorkspace)
  const setNotePickerOpen = useAppStore((state) => state.setNotePickerOpen)
  const insertPrompt = useAppStore((state) => state.insertPrompt)
  const setCurrentView = useAppStore((state) => state.setCurrentView)

  const openNotesTab = (): void => {
    setNotePickerOpen(false)
    setCurrentView('notes')
  }

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const available = useMemo(
    () => notes.filter((n) => n.scope === GLOBAL_SCOPE || n.scope === activeWorkspace?.id),
    [notes, activeWorkspace?.id]
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return available
      .filter((n) => {
        if (!q) return true
        return (
          n.title.toLowerCase().includes(q) ||
          n.body.toLowerCase().includes(q) ||
          n.tags.some((tag) => tag.includes(q))
        )
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [available, query])

  useLayoutEffect(() => {
    if (!open) {
      setAnchor(null)
      return
    }
    const trigger = document.querySelector<HTMLElement>('[data-composer-note]')
    if (!trigger) {
      setAnchor({ left: window.innerWidth / 2 - 208, bottom: 88 })
      return
    }
    const rect = trigger.getBoundingClientRect()
    const width = 416
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)
    setAnchor({ left, bottom: window.innerHeight - rect.top + 8 })
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, results.length - 1)))
  }, [results.length])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent): void => {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      if ((event.target as HTMLElement).closest?.('[data-composer-note]')) return
      setNotePickerOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open, setNotePickerOpen])

  if (!open || !anchor) return null

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setNotePickerOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const note = results[activeIndex]
      if (note) insertPrompt(note.body)
    }
  }

  return (
    <div
      ref={panelRef}
      role="listbox"
      className="fixed z-50 w-[26rem] overflow-hidden rounded-lg border border-border-strong bg-surface shadow-xl shadow-black/40 origin-bottom"
      style={{ left: anchor.left, bottom: anchor.bottom }}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <StickyNote size={14} className="shrink-0 text-dim" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t(language, 'notePickerPlaceholder')}
          className="flex-1 bg-transparent text-sm text-primary placeholder:text-faint outline-none"
        />
      </div>

      <div className="max-h-64 overflow-y-auto py-1">
        {results.length === 0 ? (
          <div className="px-3 py-5 text-center text-sm text-faint">
            {available.length === 0 ? (
              <>
                <p>{t(language, 'notePickerEmpty')}</p>
                <p className="mt-1 text-xs">{t(language, 'notePickerEmptyHint')}</p>
                <button
                  onClick={openNotesTab}
                  className="mt-3 rounded-md border border-border-strong px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent-fg hover:text-primary"
                >
                  {t(language, 'notePickerCreate')}
                </button>
              </>
            ) : (
              t(language, 'notePickerNoMatch')
            )}
          </div>
        ) : (
          results.map((note, index) => (
            <button
              key={note.id}
              onClick={() => insertPrompt(note.body)}
              onMouseEnter={() => setActiveIndex(index)}
              className={clsx(
                'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors',
                index === activeIndex ? 'bg-card' : 'hover:bg-surface-hover/50'
              )}
            >
              <span className="truncate text-sm text-primary">{note.title}</span>
              <span className="line-clamp-1 text-xs text-dim">{note.body}</span>
            </button>
          ))
        )}
      </div>

      <div className="border-t border-border px-3 py-1.5 text-[10px] text-faint">
        {t(language, 'notePickerHint')}
      </div>
    </div>
  )
}
