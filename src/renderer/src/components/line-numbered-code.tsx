import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { highlightCodeToHtml } from './chat-code-highlight'
import { useAppStore } from '../store'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'

// A model can paste thousands of lines into one fenced block. Rendering every
// line as its own row freezes the main thread, so long blocks collapse to a
// preview with an explicit expand affordance. Copy/context-menu always operate
// on the full text regardless of the collapse.
const COLLAPSE_THRESHOLD = 400

// Parsing/highlighting is O(content) with a real constant — skip it for very
// large blocks and show plain text instead of janking the UI.
const MAX_HIGHLIGHT_CHARS = 100_000

/**
 * Renders code as line-numbered, syntax-highlighted rows. Shared by file-read
 * tool results and markdown fenced blocks so both look identical.
 *
 * highlightCodeToHtml emits newlines separately from its <span> runs, so its
 * output splits cleanly on '\n' into self-contained per-line HTML; when no parser
 * matches it falls back to plain text. Base text color is inherited from the
 * caller; only the gutter is styled here.
 *
 * `onFirstLineClick`, when given, makes the first row a click target (used to
 * collapse the tool-result view).
 */
export function LineNumberedCode({
  content,
  lang,
  onFirstLineClick,
}: {
  content: string
  lang: string
  onFirstLineClick?: () => void
}): React.JSX.Element {
  const language = useAppStore(
    (state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE
  )
  const [expanded, setExpanded] = useState(false)

  // Memoized: without this, every parent re-render (e.g. each streaming token)
  // re-ran the full Lezer parse of the block.
  const html = useMemo(
    () => (content.length > MAX_HIGHLIGHT_CHARS ? null : highlightCodeToHtml(content, lang)),
    [content, lang]
  )
  const allLines = useMemo(() => (html ?? content).split('\n'), [html, content])
  const collapsed = !expanded && allLines.length > COLLAPSE_THRESHOLD
  const lines = collapsed ? allLines.slice(0, COLLAPSE_THRESHOLD) : allLines
  const gutter = `${String(allLines.length).length}ch`

  return (
    <>
      {lines.map((line, i) => {
        const clickable = i === 0 && onFirstLineClick
        return (
          <div
            key={i}
            className={clsx('flex', clickable && 'cursor-pointer hover:bg-surface-hover/40')}
            onClick={clickable ? onFirstLineClick : undefined}
            title={clickable ? t(language, 'collapse') : undefined}
          >
            <span
              className="mr-3 shrink-0 select-none text-right text-faint"
              style={{ minWidth: gutter }}
            >
              {i + 1}
            </span>
            {html !== null ? (
              <span className="whitespace-pre" dangerouslySetInnerHTML={{ __html: line || ' ' }} />
            ) : (
              <span className="whitespace-pre">{line || ' '}</span>
            )}
          </div>
        )
      })}
      {collapsed && (
        <button
          type="button"
          className="mt-1 rounded px-2 py-1 text-xs text-accent-fg hover:bg-surface-hover/50"
          onClick={() => setExpanded(true)}
        >
          {t(language, 'showAllLines', { count: String(allLines.length) })}
        </button>
      )}
    </>
  )
}
