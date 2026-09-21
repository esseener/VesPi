import { t, type AppLanguage } from '../../../shared/i18n'

/**
 * The kernel's `ask` tool has no structured dialog on the rpc-ui host.
 *
 * `runRpcMode` hands the rpc-ui host a UI object that implements select /
 * confirm / input / editor / notify / setStatus / setWidget / setTitle, but NOT
 * `askDialog` — the method the ask tool prefers. `ask` therefore falls through
 * to its legacy path, which renders the question itself as plain text and asks
 * for the answer through `editor()`.
 *
 * That text is the dialog's `title`: the question, a recap of the options (the
 * kernel appends a reserved "Other (type your own)" row and marks it with the
 * cursor glyph), an optional "… N more options …" elision, and a trailing
 * "Enter your response:" line. It is a fixed-width terminal layout that the
 * kernel truncated to `process.stdout.columns - 8`.
 *
 * Rendered verbatim into a dialog header, every newline collapsed to a space
 * (HTML `white-space` defaults to `normal`), so the whole thing became one
 * unreadable run-on paragraph, and the two English labels the kernel hardcodes
 * stayed English in a Chinese UI. These helpers recover the structure so the
 * dialog can lay it out like the rest of the app, and translate those labels.
 * Display-only: the strings the kernel matches on are never rewritten.
 */

/** The option label the kernel reserves and appends to every question. */
export const KERNEL_OTHER_LABEL = 'Other (type your own)'

/** Trailing hint line of a flattened ask prompt. */
export const KERNEL_RESPONSE_HINT = 'Enter your response:'

/** Glyphs the kernel's TUI themes use for cursor / radio / checkbox markers. */
const OPTION_MARKERS = '●○◉◎◯◍◌☐☑■□▪▫▸▹›❯'

const OPTION_LINE = new RegExp(`^([ \\t]*)([${OPTION_MARKERS}])[ \\t]+(\\S.*)$`)

/** `    … 3 more options, 1 checked …` — the kernel elides options it cannot fit. */
const MORE_LINE = /^[ \t]*…[ \t]*(\d+)[ \t]+more[ \t]+options?(?:[ \t]*,[ \t]*(\d+)[ \t]+checked)?[ \t]*…[ \t]*$/

const INDENTED = /^[ \t]{2,}/

export type AskPromptBlock =
  | { kind: 'question'; text: string }
  | { kind: 'option'; marker: string; label: string; description?: string }
  | { kind: 'more'; count: number; checked: number }
  | { kind: 'hint' }

interface RawOption {
  marker: string
  label: string
}

/**
 * Split one line into its marker and label. Accepts the marker-less form too:
 * a line that is exactly the reserved label is still the "Other" row.
 */
function readOption(line: string): RawOption | null {
  const match = OPTION_LINE.exec(line)
  if (match) return { marker: match[2], label: match[3].trim() }
  const trimmed = line.trim()
  if (trimmed === KERNEL_OTHER_LABEL) return { marker: '', label: trimmed }
  return null
}

/**
 * Localised text for an option label. Only the kernel's reserved label is
 * translated — everything else is model-authored and shown as-is. The value
 * sent back to the kernel must stay the raw label, so callers keep the original
 * string and use this for display only.
 */
export function displayOptionLabel(label: string, language: AppLanguage): string {
  return label.trim() === KERNEL_OTHER_LABEL ? t(language, 'askOtherOption') : label
}

/**
 * Parse a flattened ask prompt into blocks, or null when the text is an
 * ordinary editor title (goal objective, note editing, hook editor, …).
 *
 * Detection needs both the reserved "Other" row and the trailing hint line:
 * either one alone is too weak to distinguish a question recap from prose that
 * merely mentions it.
 */
export function parseAskPrompt(title: string | undefined | null): AskPromptBlock[] | null {
  if (!title) return null
  const lines = title.split('\n')
  const hasOther = lines.some((line) => readOption(line)?.label === KERNEL_OTHER_LABEL)
  const hasHint = lines.some((line) => line.trim() === KERNEL_RESPONSE_HINT)
  if (!hasOther || !hasHint) return null

  const blocks: AskPromptBlock[] = []
  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/, '')
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (trimmed === KERNEL_RESPONSE_HINT) {
      blocks.push({ kind: 'hint' })
      continue
    }
    const more = MORE_LINE.exec(line)
    if (more) {
      blocks.push({ kind: 'more', count: Number(more[1]), checked: Number(more[2] ?? 0) })
      continue
    }
    const option = readOption(line)
    if (option) {
      blocks.push({ kind: 'option', marker: option.marker, label: option.label })
      continue
    }
    const previous = blocks[blocks.length - 1]
    // The kernel indents an option's description under its label.
    if (previous?.kind === 'option' && INDENTED.test(line)) {
      previous.description = previous.description ? `${previous.description} ${trimmed}` : trimmed
      continue
    }
    // A question the kernel wrapped is still one question.
    if (previous?.kind === 'question') {
      previous.text = `${previous.text} ${trimmed}`
      continue
    }
    blocks.push({ kind: 'question', text: trimmed })
  }

  return blocks.some((block) => block.kind === 'option') ? blocks : null
}
