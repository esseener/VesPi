import { useState, useMemo, useEffect } from 'react'
import { clsx } from 'clsx'
import { Plus, Search, Pencil, Trash2, CornerDownLeft, Tag, ArrowLeft, StickyNote } from 'lucide-react'
import { useAppStore } from '../store'
import { MarkdownRenderer } from './markdown-renderer'
import type { Note, NoteInput } from '../../../shared/ipc-contracts'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'

const GLOBAL_SCOPE = 'global'

/** Split a free-text tag field into normalized tag tokens. */
function parseTags(raw: string): string[] {
  return [...new Set(
    raw
      .split(/[\s,]+/)
      .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
      .filter((t) => t.length > 0)
  )]
}

export function NotesPanel(): React.JSX.Element {
  const notes = useAppStore((state) => state.notes)
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const activeWorkspace = useAppStore((state) => state.activeWorkspace)
  const saveNote = useAppStore((state) => state.saveNote)
  const updateNote = useAppStore((state) => state.updateNote)
  const deleteNote = useAppStore((state) => state.deleteNote)
  const insertPrompt = useAppStore((state) => state.insertPrompt)
  const noteDraft = useAppStore((state) => state.noteDraft)
  const clearNoteDraft = useAppStore((state) => state.clearNoteDraft)

  const [query, setQuery] = useState('')
  // null = list; 'new' = create form; Note = edit form
  const [editing, setEditing] = useState<'new' | Note | null>(null)
  // Read view: the note being viewed (formatted markdown), or null for the list.
  const [viewing, setViewing] = useState<Note | null>(null)

  // A draft captured elsewhere (e.g. "Add to Notes" from a message) opens the
  // create form pre-filled with that text.
  useEffect(() => {
    if (noteDraft !== null) setEditing('new')
  }, [noteDraft])

  const leaveForm = (): void => {
    setEditing(null)
    if (noteDraft !== null) clearNoteDraft()
  }

  const scopeLabel = (scope: string): string =>
    scope === GLOBAL_SCOPE
      ? t(language, 'noteScopeGlobal')
      : scope === activeWorkspace?.id
        ? (activeWorkspace?.name ?? t(language, 'noteScopeWorkspace'))
        : t(language, 'noteScopeOther')

  // Only global notes and notes for the active workspace are relevant here.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return notes
      .filter((n) => n.scope === GLOBAL_SCOPE || n.scope === activeWorkspace?.id)
      .filter((n) => {
        if (!q) return true
        return (
          n.title.toLowerCase().includes(q) ||
          n.body.toLowerCase().includes(q) ||
          n.tags.some((t) => t.includes(q))
        )
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [notes, query, activeWorkspace?.id])

  if (editing !== null) {
    return (
      <NoteForm
        note={editing === 'new' ? null : editing}
        initialBody={editing === 'new' ? (noteDraft ?? '') : ''}
        workspaceId={activeWorkspace?.id ?? null}
        workspaceName={activeWorkspace?.name ?? null}
        onCancel={leaveForm}
        onDelete={editing === 'new' ? undefined : async () => {
          await deleteNote(editing.id)
          leaveForm()
        }}
        onSubmit={async (input) => {
          if (editing === 'new') {
            await saveNote(input)
          } else {
            await updateNote(editing.id, input)
          }
          leaveForm()
        }}
      />
    )
  }

  if (viewing !== null) {
    return (
      <NoteReadView
        note={viewing}
        scope={scopeLabel(viewing.scope)}
        onBack={() => setViewing(null)}
        onInsert={() => insertPrompt(viewing.body)}
        onEdit={() => { setEditing(viewing); setViewing(null) }}
        onDelete={async () => { await deleteNote(viewing.id); setViewing(null) }}
      />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <StickyNote size={16} className="text-muted" />
          <div className="min-w-0">
            <h1 className="text-sm font-medium text-primary">{t(language, 'notes')}</h1>
            <p className="truncate text-[11px] text-faint">{t(language, 'notesHint')}</p>
          </div>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-hover transition-colors"
        >
          <Plus size={13} />
          {t(language, 'newNote')}
        </button>
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center gap-2 rounded-md border border-border-strong bg-surface px-3 py-2">
          <Search size={14} className="shrink-0 text-dim" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(language, 'searchNotes')}
            className="flex-1 bg-transparent text-sm text-primary placeholder:text-faint outline-none"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-6">
        {visible.length === 0 ? (
          <div className="mt-8 text-center text-sm text-faint">
            {query.trim() ? t(language, 'noteNoMatch') : t(language, 'noteEmpty')}
          </div>
        ) : (
          visible.map((note) => (
            <div
              key={note.id}
              className="group rounded-md border border-border bg-surface p-3 hover:border-border-strong transition-colors"
            >
              <button
                onClick={() => setViewing(note)}
                className="block w-full text-left"
                title={t(language, 'notes')}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-primary">{note.title}</span>
                  <span
                    className={clsx(
                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
                      note.scope === GLOBAL_SCOPE
                        ? 'bg-card text-muted'
                        : 'bg-accent-bg text-accent-fg'
                    )}
                  >
                    {scopeLabel(note.scope)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-dim">{note.body}</p>
                {note.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Tag size={10} className="text-faint" />
                    {note.tags.map((tag) => (
                      <span key={tag} className="rounded bg-card px-1.5 py-0.5 text-[10px] text-muted">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>

              <div className="mt-2 flex items-center gap-1">
                <button
                  onClick={() => insertPrompt(note.body)}
                  className="flex items-center gap-1 rounded bg-card px-2 py-1 text-xs text-secondary hover:bg-elevated transition-colors"
                  title={t(language, 'noteInsert')}
                >
                  <CornerDownLeft size={11} />
                  {t(language, 'noteInsert')}
                </button>
                <button
                  onClick={() => setEditing(note)}
                  className="rounded p-1 text-dim hover:text-secondary transition-colors"
                  title={t(language, 'editNote')}
                  aria-label={t(language, 'editNote')}
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(t(language, 'noteDeleteConfirm'))) void deleteNote(note.id)
                  }}
                  className="rounded p-1 text-dim hover:text-error transition-colors"
                  title={t(language, 'noteDelete')}
                  aria-label={t(language, 'noteDelete')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Note Read View ─────────────────────────────────────────────────────────

function NoteReadView({
  note,
  scope,
  onBack,
  onInsert,
  onEdit,
  onDelete,
}: {
  note: Note
  scope: string
  onBack: () => void
  onInsert: () => void
  onEdit: () => void
  onDelete: () => void
}): React.JSX.Element {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onBack}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-hover hover:text-primary transition-colors"
            title={t(language, 'noteBack')}
          >
            <ArrowLeft size={13} />
            {t(language, 'noteBack')}
          </button>
          <h1 className="truncate text-sm font-medium text-primary">{note.title}</h1>
          <span className="shrink-0 rounded bg-card px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
            {scope}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onInsert}
            className="flex items-center gap-1 rounded bg-card px-2 py-1 text-xs text-secondary hover:bg-elevated transition-colors"
            title={t(language, 'noteInsert')}
          >
            <CornerDownLeft size={11} />
            {t(language, 'noteInsert')}
          </button>
          <button
            onClick={onEdit}
            className="rounded p-1 text-dim hover:text-secondary transition-colors"
            title={t(language, 'editNote')}
            aria-label={t(language, 'editNote')}
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={() => {
              if (window.confirm(t(language, 'noteDeleteConfirm'))) onDelete()
            }}
            className="rounded p-1 text-dim hover:text-error transition-colors"
            title={t(language, 'noteDelete')}
            aria-label={t(language, 'noteDelete')}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Tags */}
      {note.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border/60 px-4 py-2">
          <Tag size={11} className="text-faint" />
          {note.tags.map((tag) => (
            <span key={tag} className="rounded bg-card px-1.5 py-0.5 text-[10px] text-muted">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Rendered body — markdown with preserved indents, line breaks, code blocks */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="markdown-body text-sm text-primary">
          <MarkdownRenderer content={note.body} />
        </div>
      </div>
    </div>
  )
}

// ─── Note Form ────────────────────────────────────────────────────────────────

function NoteForm({
  note,
  initialBody,
  workspaceId,
  workspaceName,
  onSubmit,
  onCancel,
  onDelete,
}: {
  note: Note | null
  initialBody: string
  workspaceId: string | null
  workspaceName: string | null
  onSubmit: (input: NoteInput) => Promise<void>
  onCancel: () => void
  onDelete?: () => Promise<void>
}): React.JSX.Element {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? initialBody)
  const [tagsRaw, setTagsRaw] = useState(note?.tags.join(' ') ?? '')
  const [scope, setScope] = useState<string>(note?.scope ?? GLOBAL_SCOPE)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const canSave = title.trim().length > 0 && body.trim().length > 0 && !saving

  const handleSubmit = async (): Promise<void> => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await onSubmit({ title: title.trim(), body: body.trim(), tags: parseTags(tagsRaw), scope })
    } catch (err) {
      setError(err instanceof Error ? err.message : t(language, 'noteSaveFailed'))
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <h1 className="text-sm font-medium text-primary">{note ? t(language, 'editNote') : t(language, 'newNote')}</h1>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted">{t(language, 'noteTitle')}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t(language, 'noteTitlePlaceholder')}
            className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-primary placeholder:text-faint focus:border-focus focus:outline-none"
            autoFocus
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">{t(language, 'noteBody')}</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t(language, 'noteBodyPlaceholder')}
            rows={8}
            className="w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-primary placeholder:text-faint focus:border-focus focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">{t(language, 'noteTags')}</label>
          <input
            type="text"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder={t(language, 'noteTagsPlaceholder')}
            className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-primary placeholder:text-faint focus:border-focus focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted">{t(language, 'noteScope')}</label>
          <div className="flex gap-2">
            <ScopeButton active={scope === GLOBAL_SCOPE} onClick={() => setScope(GLOBAL_SCOPE)} label={t(language, 'noteScopeGlobal')} />
            {workspaceId && (
              <ScopeButton
                active={scope === workspaceId}
                onClick={() => setScope(workspaceId)}
                label={workspaceName ?? t(language, 'noteScopeWorkspace')}
              />
            )}
          </div>
        </div>

        {error && <div className="rounded-md bg-error-bg px-3 py-2 text-xs text-error">{error}</div>}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <button
          onClick={handleSubmit}
          disabled={!canSave}
          className="rounded-md bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50 transition-colors"
        >
          {saving ? t(language, 'noteSaving') : t(language, 'noteSave')}
        </button>
        <button
          onClick={onCancel}
          className="rounded-md px-4 py-1.5 text-sm text-muted hover:text-primary transition-colors"
        >
          {t(language, 'noteCancel')}
        </button>
        {onDelete && (
          <button
            onClick={() => {
              if (window.confirm(t(language, 'noteDeleteConfirm'))) void onDelete()
            }}
            className="ml-auto flex items-center gap-1 rounded-md px-3 py-1.5 text-sm text-error hover:bg-error-bg transition-colors"
          >
            <Trash2 size={13} />
            {t(language, 'noteDelete')}
          </button>
        )}
      </div>
    </div>
  )
}

function ScopeButton({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-md border px-3 py-1.5 text-xs transition-colors',
        active
          ? 'border-focus bg-accent-bg text-accent-fg'
          : 'border-border-strong bg-surface text-muted hover:text-primary'
      )}
    >
      {label}
    </button>
  )
}
