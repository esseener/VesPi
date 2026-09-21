import assert from 'node:assert/strict'
import {
  KERNEL_OTHER_LABEL,
  KERNEL_RESPONSE_HINT,
  displayOptionLabel,
  parseAskPrompt,
} from './ask-prompt-text'

// A verbatim-shaped dump from the kernel's ask fallback: question first, then
// the option recap (reserved "Other" row gets the cursor glyph), then the hint.
const ASK_PROMPT = [
  '文档缺的两个口径（特码命中率 0.56 的 TOP5 分层加权、综合评分 0.7186 的…',
  '',
  '○ 先用原值汇总，不合成就用现在的 TOP1/TOP5/12/22 命中率 + 正码覆盖率 + 校准',
  '○ 我给权重表和评分公式，你按我的口径补齐，就能复现',
  '    这条会顺带补一张权重表',
  '○ 只要逐期命中明细，不要汇总，回测只输出每期逐条命中情况',
  `● ${KERNEL_OTHER_LABEL}`,
  '',
  KERNEL_RESPONSE_HINT,
].join('\n')

const blocks = parseAskPrompt(ASK_PROMPT)
assert.notEqual(blocks, null)

assert.deepEqual(
  blocks!.map((block) => block.kind),
  ['question', 'option', 'option', 'option', 'option', 'hint']
)

assert.equal(
  blocks![0].kind === 'question' ? blocks![0].text : null,
  '文档缺的两个口径（特码命中率 0.56 的 TOP5 分层加权、综合评分 0.7186 的…'
)

const options = blocks!.filter((block) => block.kind === 'option')
assert.deepEqual(
  options.map((option) => option.marker),
  ['○', '○', '○', '●']
)
assert.equal(options[3].label, KERNEL_OTHER_LABEL)
assert.equal(options[1].description, '这条会顺带补一张权重表')
assert.equal(options[0].description, undefined)
assert.equal(blocks![5].kind, 'hint')

// The reserved label is the only string that gets translated — the model's own
// wording is shown untouched.
assert.equal(displayOptionLabel(KERNEL_OTHER_LABEL, 'zh'), '其他（自己输入）')
assert.equal(displayOptionLabel(KERNEL_OTHER_LABEL, 'en'), KERNEL_OTHER_LABEL)
assert.equal(displayOptionLabel('先用原值汇总', 'zh'), '先用原值汇总')
assert.equal(displayOptionLabel(` ${KERNEL_OTHER_LABEL} `, 'zh'), '其他（自己输入）')

// The elision row the kernel emits when it cannot fit every option.
const elided = parseAskPrompt(
  ['选哪个？', '○ 甲', '    … 3 more options, 1 checked …', `○ ${KERNEL_OTHER_LABEL}`, KERNEL_RESPONSE_HINT].join('\n')
)
assert.deepEqual(
  elided!.map((block) => block.kind),
  ['question', 'option', 'more', 'option', 'hint']
)
assert.deepEqual(elided![2], { kind: 'more', count: 3, checked: 1 })

// A marker-less "Other" row is still recognised, so a theme that renders no
// glyph does not lose the whole recap to the plain-text fallback.
const markerless = parseAskPrompt(['问题', KERNEL_OTHER_LABEL, KERNEL_RESPONSE_HINT].join('\n'))
assert.deepEqual(
  markerless!.map((block) => block.kind),
  ['question', 'option', 'hint']
)
assert.equal(markerless![1].kind === 'option' ? markerless![1].marker : 'x', '')

// Ordinary editor titles must not be mistaken for a question recap: both
// sentinels are required, so prose that happens to mention one stays plain.
assert.equal(parseAskPrompt('Goal objective'), null)
assert.equal(parseAskPrompt('编辑笔记'), null)
assert.equal(parseAskPrompt(undefined), null)
assert.equal(parseAskPrompt(''), null)
assert.equal(parseAskPrompt([KERNEL_RESPONSE_HINT].join('\n')), null)
assert.equal(parseAskPrompt([`○ ${KERNEL_OTHER_LABEL}`].join('\n')), null)
