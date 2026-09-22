// Imported for the JSX runtime as well as the `React.JSX.Element` type below:
// Vite compiles JSX automatically, but `tsx --test` does not read that config
// and falls back to the classic runtime, which needs React in scope. The
// component's render test runs through that path.
import React, { useState } from 'react'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import type { AttachedFileBlock } from '../../../shared/attached-file'
import { useAppStore } from '../store'

/**
 * One attached file inside a sent message.
 *
 * A text attachment has to be inlined into the prompt for the model to be able
 * to read it, so the sent message genuinely contains the whole file — and the
 * bubble used to render that, which buried the conversation under whatever was
 * attached. The card is the transcript's side of that trade: the name and the
 * size are enough to recognise it, and the content is one click away.
 *
 * Collapsed by default, and each card holds its own state so opening one never
 * moves the others.
 */
export function AttachedFileCard({ file }: { file: AttachedFileBlock }): React.JSX.Element {
  const language = useAppStore(
    (state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE
  )
  const [open, setOpen] = useState(false)
  const lines = file.content.length === 0 ? 0 : file.content.split('\n').length

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-app/40">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${t(language, open ? 'attachedFileHide' : 'attachedFileShow')} ${file.name}`}
        title={file.name}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-surface-hover"
      >
        <FileText size={13} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 truncate font-chat text-xs text-primary">{file.name}</span>
        <span className="shrink-0 text-[10px] text-dim">
          {t(language, 'attachedFileLines', { count: String(lines) })}
        </span>
        {open ? (
          <ChevronDown size={13} className="shrink-0 text-muted" />
        ) : (
          <ChevronRight size={13} className="shrink-0 text-muted" />
        )}
      </button>
      {open && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-border px-2.5 py-2 font-jetbrains text-[11px] leading-relaxed text-secondary">
          {file.content}
        </pre>
      )}
    </div>
  )
}
