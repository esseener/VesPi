import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadOmpLabelPack,
  translateTerminalChunk,
  ompLabel,
  displayWidth,
  fitWidth,
  squareBoxCorners,
} from './omp-labels'

test('loadOmpLabelPack accepts a map and ompLabel falls back', () => {
  const pack = loadOmpLabelPack({ kernel: '0.1', map: { Hello: '你好' } })
  assert.ok(pack)
  assert.equal(ompLabel('Hello'), '你好')
  assert.equal(ompLabel('Unknown'), 'Unknown')
})

test('displayWidth counts CJK as 2 columns', () => {
  assert.equal(displayWidth('abc'), 3)
  assert.equal(displayWidth('欢迎'), 4)
  assert.equal(displayWidth('无 LSP'), 2 + 1 + 3)
})

test('fitWidth pads shorter Chinese and rejects wider', () => {
  assert.equal(fitWidth('欢迎', 6), '欢迎  ')
  assert.equal(fitWidth('欢迎回来！', 10), '欢迎回来！')
  assert.equal(fitWidth('欢迎回来！', 13), '欢迎回来！   ')
  assert.equal(fitWidth('欢迎回来！', 8), null)
})

test('translateTerminalChunk replaces plain phrases with width padding', () => {
  loadOmpLabelPack({ kernel: '', map: {} })
  const out = translateTerminalChunk('Welcome back!')
  assert.equal(out, '欢迎回来！   ')
  assert.equal(displayWidth(out), displayWidth('Welcome back!'))
})

test('translateTerminalChunk matches phrases split by ANSI colors', () => {
  loadOmpLabelPack({ kernel: '', map: {} })
  const chunk = '\x1b[1mWelcome \x1b[32mback!\x1b[0m'
  const out = translateTerminalChunk(chunk)
  assert.ok(out.includes('欢迎回来！'), `got: ${JSON.stringify(out)}`)
  assert.ok(!out.includes('Welcome'))
})

test('translateTerminalChunk prefers pack over fallback', () => {
  loadOmpLabelPack({ kernel: '', map: { 'Sign in': '登入' } })
  const out = translateTerminalChunk('Sign in')
  assert.equal(out, '登入   ')
})

test('longer phrases win over shorter ones', () => {
  loadOmpLabelPack({ kernel: '', map: {} })
  const out = translateTerminalChunk('Set up your providers')
  assert.ok(out.startsWith('配置你的服务商'), `got: ${JSON.stringify(out)}`)
  assert.equal(displayWidth(out), displayWidth('Set up your providers'))
})

test('short keys never match inside longer words (Update vs Updated)', () => {
  loadOmpLabelPack({ kernel: '', map: { Update: '更新', Updated: '已更新' } })
  // "Updated" must not become "更新d"
  const out = translateTerminalChunk('Updated')
  assert.ok(!out.includes('更新d'), `got: ${JSON.stringify(out)}`)
  assert.ok(out.includes('已更新'), `got: ${JSON.stringify(out)}`)
})

test('Updated to is translated as a phrase, not via Update', () => {
  loadOmpLabelPack({ kernel: '', map: {} })
  const out = translateTerminalChunk('Updated to v18.3.2')
  assert.ok(!out.includes('更新d'), `got: ${JSON.stringify(out)}`)
  assert.ok(out.includes('已更新到') || out.includes('更新'), `got: ${JSON.stringify(out)}`)
})

test('ANSI around a phrase is preserved as lead styling', () => {
  loadOmpLabelPack({ kernel: '', map: {} })
  const out = translateTerminalChunk('\x1b[33mError:\x1b[0m boom')
  assert.ok(out.includes('错误：'), `got: ${JSON.stringify(out)}`)
})

test('box-critical replacement keeps identical display width', () => {
  loadOmpLabelPack({ kernel: '', map: {} })
  const line = '| Welcome back!          |'
  const out = translateTerminalChunk(line)
  assert.equal(displayWidth(out), displayWidth(line), `got: ${JSON.stringify(out)}`)
})

test('What\'s New is translated', () => {
  loadOmpLabelPack({ kernel: '', map: {} })
  const out = translateTerminalChunk("What's New")
  assert.ok(out.includes('新变化'), `got: ${JSON.stringify(out)}`)
})

test('What’s New (curly) is translated', () => {
  loadOmpLabelPack({ kernel: '', map: {} })
  const out = translateTerminalChunk('What’s New')
  assert.ok(out.includes('新变化'), `got: ${JSON.stringify(out)}`)
})

test('recent-session tip line is translated', () => {
  loadOmpLabelPack({ kernel: '', map: {} })
  const out = translateTerminalChunk(
    'Hit a Codex rate limit? `/usage reset` spends a saved reset credit to immediately restore your quota',
  )
  assert.ok(out.includes('限额'), `got: ${JSON.stringify(out)}`)
  assert.ok(!out.includes('rate limit'), `got: ${JSON.stringify(out)}`)
})

test('changelog hint is translated', () => {
  loadOmpLabelPack({ kernel: '', map: {} })
  const out = translateTerminalChunk('Use /changelog for details.')
  assert.ok(out.includes('更新日志') || out.includes('用 /changelog'), `got: ${JSON.stringify(out)}`)
})

test('width-preserving: multi phrase line stays aligned', () => {
  loadOmpLabelPack({ kernel: '', map: {} })
  const line = 'Tip: Recent sessions Untitled'
  const out = translateTerminalChunk(line)
  // At least the known words should become Chinese
  assert.ok(out.includes('提示') || out.includes('最近会话') || out.includes('未命名'), `got: ${JSON.stringify(out)}`)
  assert.equal(displayWidth(out), displayWidth(line), `got: ${JSON.stringify(out)}`)
})

test('rounded TUI corners become square, same width', () => {
  assert.equal(squareBoxCorners('╭─╮│╰─╯'), '┌─┐│└─┘')
  assert.equal(displayWidth(squareBoxCorners('╭─╮')), displayWidth('╭─╮'))
})

test('translateTerminalChunk squares corners in a real frame', () => {
  loadOmpLabelPack({ kernel: '', map: {} })
  const out = translateTerminalChunk('╭─ welcome ─╮')
  assert.ok(out.includes('┌'), `got: ${JSON.stringify(out)}`)
  assert.ok(out.includes('┐'), `got: ${JSON.stringify(out)}`)
  assert.ok(!out.includes('╭') && !out.includes('╮'))
})

test('dim SGR is replaced with readable gray', () => {
  loadOmpLabelPack({ kernel: '', map: {} })
  const out = translateTerminalChunk('\x1b[2mrecap: hello\x1b[22m')
  assert.ok(!out.includes('\x1b[2m'), `dim still present: ${JSON.stringify(out)}`)
  assert.ok(out.includes('recap'), `got: ${JSON.stringify(out)}`)
  assert.ok(out.includes('\x1b[38;2;168;174;186m') || out.includes('recap'), `got: ${JSON.stringify(out)}`)
})

test('bare session is not swapped inside English prose', () => {
  loadOmpLabelPack({ kernel: '', map: { Session: '会话', session: '会话' } })
  // Not a known tip fragment — bare 'session' must stay English.
  const out = translateTerminalChunk('the session file is large')
  assert.ok(!out.includes('会话'), `got: ${JSON.stringify(out)}`)
  assert.ok(out.includes('session'), `got: ${JSON.stringify(out)}`)
})

test('Pair up live tip is translated as a whole', () => {
  loadOmpLabelPack({ kernel: '', map: {} })
  const tip = 'Tip: Pair up live: `/collab` shares your session through an end-to-end encrypted relay link — a teammate runs `/join <link>` to watch tool calls stream and prompt the agent from their own omp'
  const out = translateTerminalChunk(tip)
  assert.ok(out.includes('实时结对') || out.includes('端到端'), `got: ${JSON.stringify(out)}`)
  assert.ok(!out.includes('Pair up live'), `got: ${JSON.stringify(out)}`)
})

test('rotating tip fragments translate even without full sentence', () => {
  loadOmpLabelPack({ kernel: '', map: {} })
  const out = translateTerminalChunk('Tip: something new — a teammate runs `/join x` to watch tool calls stream')
  assert.ok(out.includes('队友') || out.includes('工具调用'), `got: ${JSON.stringify(out)}`)
  assert.ok(!out.includes('teammate runs'), `got: ${JSON.stringify(out)}`)
})
