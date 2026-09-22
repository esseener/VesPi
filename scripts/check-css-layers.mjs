// scripts/check-css-layers.mjs
//
// Fails when an UNLAYERED rule can override the Tailwind utility layer.
//
// Why this exists: Tailwind v4 puts `.fixed`, `.absolute`, `.z-*` and friends in
// `@layer utilities`, and an unlayered declaration outranks every layer. A rule
// such as
//
//   .app-console > *:not(.app-console-mesh) { position: relative; z-index: 2 }
//
// therefore silently rewrote the positioning of every direct child: `absolute
// inset-0` stopped meaning "fill the window", `fixed` stopped meaning "pin to
// the viewport", and every `z-*` was flattened to 2. It carried `:not()`
// exclusions for the overlays known at the time, which made it read as
// deliberate — and it still broke the next two elements added under it (the
// folder-drop overlay and the collapsed-sidebar toggle). Each time the symptom
// looked like a component bug, and each time it cost a round of debugging.
//
// Only the shape that actually caused that is flagged: the selector's subject —
// the rightmost compound of a comma-separated part, with pseudo-classes removed
// — is a universal `*` or a bare element type rather than a class or id. A rule
// whose subject is a class was written by whoever owns that element's markup, so
// there is nothing to surprise; a rule that says "every child of X" is reaching
// into markup it cannot see.
//
// Opt a rule out with a `css-layer-exempt` comment when the override is
// deliberate and the element cannot also carry a utility class.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = 'src/renderer/src'

/** Properties the utility layer declares for the same elements. */
const OWNED_BY_UTILITIES =
  /^(position|z-index|inset|inset-[a-z]+|top|right|bottom|left|display|visibility|opacity|float|clear|overflow|overflow-[a-z]+)\s*:/

/** At-rules whose contents are not style rules and must not be inspected. */
const SKIP_AT_RULE = /^@(?:-(?:webkit|moz)-)?(?:keyframes|font-face|property|counter-style|font-feature-values)\b/

const EXEMPT_MARKER = 'css-layer-exempt'

function stripPseudoClasses(text) {
  return text.replace(/::?[a-z-]+(\([^()]*\))?/gi, '')
}

/**
 * True when any comma-separated part of `selector` ends in a compound that is
 * not qualified by a class or an id — i.e. it reaches elements it does not name.
 */
function subjectIsUnclassed(selector) {
  return selector
    .split(',')
    .map((part) => stripPseudoClasses(part).trim())
    .filter((part) => part.length > 0)
    .some((part) => {
      const compound = part.split(/[>+~\s]+/).filter(Boolean).pop() ?? ''
      if (compound.length === 0) return false
      return compound.includes('*') || (!compound.includes('.') && !compound.includes('#'))
    })
}

/**
 * Comments are blanked rather than deleted, so every offset and line number in
 * the parsed source still addresses the original text — which is what lets the
 * exemption marker (a comment) be read back out of `raw` at the same offsets.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
}

/**
 * Every block in `source`, with its header text, body, and the block that
 * encloses it. A flat scan with a stack — enough for CSS, and it keeps the
 * declaration scan inside a block rather than restricted to one line.
 */
function parseBlocks(source) {
  const blocks = []
  const stack = []
  let headerStart = 0

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') {
      const id = blocks.length
      blocks.push({
        header: source.slice(headerStart, index).trim(),
        headerAt: headerStart,
        body: '',
        parent: stack.length > 0 ? stack[stack.length - 1] : null,
      })
      stack.push(id)
      headerStart = index + 1
    } else if (char === '}') {
      const id = stack.pop()
      if (id !== undefined) {
        blocks[id].body = source.slice(blocks[id].headerAt + blocks[id].header.length, index)
      }
      headerStart = index + 1
    }
  }
  return { blocks, stack }
}

/** The header text an ancestor chain is made of, outermost first. */
function ancestorHeaders(blocks, block) {
  const headers = []
  let current = block.parent
  while (current !== null && current !== undefined) {
    headers.push(blocks[current].header)
    current = blocks[current].parent
  }
  return headers
}

const files = []
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full)
    else if (full.endsWith('.css')) files.push(full)
  }
}
walk(ROOT)

const violations = []

for (const file of files) {
  const raw = readFileSync(file, 'utf-8')
  const source = stripComments(raw)
  const { blocks } = parseBlocks(source)

  for (const block of blocks) {
    if (block.header.startsWith('@') || block.header.length === 0) continue
    const ancestors = ancestorHeaders(blocks, block)
    if (ancestors.some((header) => /^@layer\b/i.test(header))) continue
    if (ancestors.some((header) => SKIP_AT_RULE.test(header))) continue
    if (!subjectIsUnclassed(block.header)) continue

    const owned = block.body
      .split(';')
      .map((declaration) => declaration.trim())
      .filter((declaration) => OWNED_BY_UTILITIES.test(declaration))
    if (owned.length === 0) continue

    // The exemption marker lives in a comment, so it is read back from the raw
    // text — from the end of whatever preceded this selector to the end of its
    // block, which covers a marker written directly above the rule.
    const precedingBreak = Math.max(
      source.lastIndexOf('}', block.headerAt),
      source.lastIndexOf('{', block.headerAt)
    )
    const marked = raw
      .slice(precedingBreak + 1, block.headerAt + block.header.length + block.body.length + 1)
      .includes(EXEMPT_MARKER)
    if (marked) continue

    violations.push({
      file: relative(process.cwd(), file),
      line: source.slice(0, block.headerAt).split('\n').length,
      selector: block.header,
      properties: owned.map((declaration) => declaration.split(':')[0].trim()).join(', '),
    })
  }
}

if (violations.length > 0) {
  console.error('[check-css-layers] Unlayered rule(s) can override Tailwind utilities:')
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.selector}`)
    console.error(`    declares ${violation.properties}`)
  }
  console.error('')
  console.error('Wrap the rule in `@layer components { … }` (or `base`), so a utility class on the')
  console.error('element wins as authored. If the override is deliberate and the element cannot')
  console.error(`carry a utility class, mark it \`${EXEMPT_MARKER}\`.`)
  process.exit(1)
}

console.log(
  `[check-css-layers] OK — ${files.length} stylesheet(s), no unlayered rule overrides the utility layer`
)
