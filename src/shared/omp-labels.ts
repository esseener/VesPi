/**
 * Translation pack: English source string → Chinese.
 * Written by the bundled LAYA pipeline after each OMP kernel update.
 * Display layers look up here first; unknown keys fall back to the original.
 *
 * Terminal overlay rules (critical for TUI box layout):
 * 1. Replacement MUST preserve display width — CJK is 2 columns, ASCII is 1.
 *    We pad with spaces so box-drawing columns stay aligned.
 * 2. Short ASCII keys match on word boundaries only (never inside "Updated").
 * 3. Longest phrase wins.
 */
export interface OmpLabelPack {
  kernel: string
  map: Record<string, string>
}

let cached: OmpLabelPack | null = null

export function loadOmpLabelPack(raw: unknown): OmpLabelPack | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as { kernel?: unknown; map?: unknown }
  if (!obj.map || typeof obj.map !== 'object') return null
  cached = {
    kernel: typeof obj.kernel === 'string' ? obj.kernel : '',
    map: obj.map as Record<string, string>,
  }
  return cached
}

export function ompLabel(source: string): string {
  return cached?.map[source] ?? source
}

export function ompLabelPack(): OmpLabelPack | null {
  return cached
}

/** Terminal display width: CJK/fullwidth = 2, else 1. */
export function displayWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1f64f) ||
      (c >= 0x20000 && c <= 0x3fffd)
    ) {
      w += 2
    } else {
      w += 1
    }
  }
  return w
}

/**
 * Fit a Chinese label into `width` display columns.
 * Pad with spaces when shorter; return null when wider (caller must skip
 * or the TUI box borders will shear).
 */
export function fitWidth(zh: string, width: number): string | null {
  const w = displayWidth(zh)
  if (w === width) return zh
  if (w < width) return zh + ' '.repeat(width - w)
  return null
}

/**
 * Fallback phrase table — applied even before the pack loads.
 * Longest first. Short keys are word-boundary only.
 */
export const TERMINAL_PHRASES: Array<[string, string]> = (
  [
    // ── long sentences / status lines ──────────────────────────────────
    ['Tip: Pair up live: `/collab` shares your session through an end-to-end encrypted relay link — a teammate runs `/join <link>` to watch tool calls stream and prompt the agent from their own omp', '提示：实时结对：`/collab` 通过端到端加密中继链路分享你的会话 — 队友执行 `/join <链接>` 即可观看工具调用流，并从他们自己的 omp 里指挥智能体'],
    ['Tip: Pair up live: `/collab` shares your session through an end-to-end encrypted relay link - a teammate runs `/join <link>` to watch tool calls stream and prompt the agent from their own omp', '提示：实时结对：`/collab` 通过端到端加密中继链路分享你的会话 — 队友执行 `/join <链接>` 即可观看工具调用流，并从他们自己的 omp 里指挥智能体'],
    ['Pair up live: `/collab` shares your session through an end-to-end encrypted relay link — a teammate runs `/join <link>` to watch tool calls stream and prompt the agent from their own omp', '实时结对：`/collab` 通过端到端加密中继链路分享你的会话 — 队友执行 `/join <链接>` 即可观看工具调用流，并从他们自己的 omp 里指挥智能体'],
    ['a teammate runs `/join <link>` to watch tool calls stream and prompt the agent from their own omp', '队友执行 `/join <链接>` 即可观看工具调用流，并从他们自己的 omp 里指挥智能体'],
    ['shares your session through an end-to-end encrypted relay link', '通过端到端加密中继链路分享你的会话'],
    ['through an end-to-end encrypted relay link', '通过端到端加密中继链路'],
    ['to watch tool calls stream and prompt the agent from their own', '即可观看工具调用流，并从他们自己的'],
    ['Pair up live:', '实时结对：'],
    ['Hit a Codex rate limit? `/usage reset` spends a saved reset credit to immediately restore your quota', '碰到 Codex 限额？`/usage reset` 可消耗已存重置额度立刻恢复配额'],
    ['Have the agent interview you in chat, then set up goal mode', '让智能体在对话中访谈你，再进入目标模式'],
    ['Plan, run, inspect, import, and compare OMP-native security scans', '计划、运行、检查、导入并对比 OMP 安全扫描'],
    ['Set up your providers', '配置你的服务商'],
    ['Select provider to login', '选择要登录的服务商'],
    ['Select provider to logout', '选择要退出的服务商'],
    ['Sign in and pick a web search provider. Press Esc when you\'re done.', '登录并选择网页搜索服务商。完成后按 Esc。'],
    ['Press Esc when you\'re done.', '完成后按 Esc。'],
    ['Plan review: plan mode inactive', '计划审查：未进入计划模式'],
    ['No models available. Use /login or set an API key environment variable. Then use /model to select a model.', '暂无可用模型。请 /login 或设置 API 密钥环境变量，再用 /model 选择模型。'],
    ['No todos. Use /todo append <task> to start one.', '暂无待办。用 /todo append <任务> 新建一条。'],
    ['Auto-compacting context... (esc to cancel)', '正在自动压缩上下文…（Esc 取消）'],
    ['Compacting context... (esc to cancel)', '正在压缩上下文…（Esc 取消）'],
    ['Goal mode is already active. Use /goal to manage it, or /goal drop to start over.', '目标模式已激活。用 /goal 管理，或 /goal drop 重新开始。'],
    ['Goal mode is disabled. Enable it in settings (goal.enabled).', '目标模式已禁用。请在设置中开启（goal.enabled）。'],
    ['Plan mode is disabled. Enable it in settings (plan.enabled).', '计划模式已禁用。请在设置中开启（plan.enabled）。'],
    ['Plan mode is paused', '计划模式已暂停'],
    ['Exit plan mode first.', '请先退出计划模式。'],
    ['Could not generate a session title. Use /rename <title> to set one.', '无法生成会话标题。用 /rename <标题> 手动设置。'],
    ['MCP notifications require the TUI client (live MCPManager). Use /mcp list to see server status.', 'MCP 通知需要 TUI 客户端（实时 MCPManager）。用 /mcp list 查看服务状态。'],
    ['Unknown /mcp subcommand', '未知 /mcp 子命令'],
    ['Use /mcp help for available subcommands.', '用 /mcp help 查看可用子命令。'],
    ['Vibe mode enabled. You direct fast/good worker sessions; toolset is read + optional parent Todo + vibe tools.', '氛围模式已开启。你指挥快/好工作会话；工具为只读 + 可选父级待办 + vibe 工具。'],
    ['Connecting to', '正在连接'],
    ['Connected to MCP servers', '已连接 MCP 服务'],
    ['Connecting to MCP servers', '正在连接 MCP 服务'],
    ['Connected to MCP server', '已连接 MCP 服务'],
    ['Connecting to MCP server', '正在连接 MCP 服务'],
    ['Working directory', '工作目录'],
    ['New session', '新会话'],
    ['Recent sessions', '最近会话'],
    ['Compact context', '压缩上下文'],
    ['Token usage', '令牌用量'],
    ['Thinking level', '思考等级'],
    ['Open settings menu', '打开设置菜单'],
    ['Open provider setup', '打开服务商设置'],
    ['Restart required', '需要重启'],
    ['for prompt actions', '用于提示操作'],
    ['to run python', '运行 python'],
    ['to run bash', '运行 bash'],
    ['for commands', '用于命令'],
    ['Enter confirm', '回车确认'],
    ['enter confirm', '回车确认'],
    ['Esc skip', 'Esc 跳过'],
    ['Esc to cancel', 'Esc 取消'],
    ['Esc to close', 'Esc 关闭'],
    ['Esc to go back', 'Esc 返回'],
    ['Esc to cancel', 'Esc 取消'],
    ['Enter to submit', '回车提交'],
    ['Enter to confirm', '回车确认'],
    ['Enter to configure', '回车配置'],
    ['Enter to confirm', '回车确认'],
    ['Type to search', '输入以搜索'],
    ['↑↓ select', '↑↓ 选择'],
    ['↑↓ to jump sections', '↑↓ 跳转分区'],
    ['Tab/Enter to settings', 'Tab/回车 进设置'],
    ['←/→ to switch tabs', '←/→ 切换标签'],
    ['Space to toggle', '空格 切换'],
    ['a to select all', 'a 全选'],
    ['n to select none', 'n 全不选'],
    ['i to invert', 'i 反选'],
    ['Ctrl+D to finish', 'Ctrl+D 完成'],
    ['Ctrl+C to cancel', 'Ctrl+C 取消'],
    ['ctrl+c exit setup', 'Ctrl+C 退出安装'],
    ['Welcome back!', '欢迎回来！'],
    ['What\'s New', '新变化'],
    ['What’s New', '新变化'],
    ['No LSP servers', '无 LSP 服务'],
    ['No side questions yet. Use /btw QUESTION to start one.', '暂无旁问。用 /btw 问题 开始一条。'],
    ['Use /changelog for details.', '用 /changelog 查看详情。'],
    ['Use /changelog full for history.', '用 /changelog full 查看历史。'],
    ['changes in 1 release', '项变更 · 1 个版本'],
    ['changes in', '项变更 ·'],
    ['in 1 release', '共 1 个版本'],
    ['in 1 releases', '共 1 个版本'],
    ['earlier release', '更早版本'],
    ['earlier releases', '更早版本'],
    ['2 added', '2 新增'],
    ['2 changed', '2 变更'],
    ['8 fixed', '8 修复'],
    ['12 changes', '12 项变更'],
    ['Use /rename', '用 /rename'],
    ['Use /login', '用 /login'],
    ['Use /model', '用 /model'],
    ['Use /goal', '用 /goal'],
    ['Use /mcp', '用 /mcp'],
    ['Use /todo', '用 /todo'],
    ['Use /btw', '用 /btw'],
    ['Use /agents', '用 /agents'],
    ['Use /marketplace', '用 /marketplace'],
    ['Web search', '网页搜索'],
    ['Update Available', '有可用更新'],
    ['Updated to', '已更新到'],
    ['across', '跨'],
    ['New version', '新版本'],
    ['is available', '已可用'],
    ['Please run', '请运行'],
    ['Setup step', '安装步骤'],
    ['LSP Servers', 'LSP 服务'],
    ['MCP Servers', 'MCP 服务'],
    ['MCP Server', 'MCP 服务'],
    ['Tip:', '提示：'],
    ['Tips', '提示'],
    ['Loading', '加载中'],
    ['Thinking', '思考中'],
    ['Untitled', '未命名'],
    ['just now', '刚刚'],
    ['minutes ago', '分钟前'],
    ['hours ago', '小时前'],
    ['days ago', '天前'],
    ['Sign in', '登录'],
    ['Login', '登录'],
    ['Run:', '请运行：'],
    ['Error:', '错误：'],
    ['Warning:', '警告：'],
    ['Done', '完成'],
    ['Cancel', '取消'],
    ['Confirm', '确认'],
    ['Help', '帮助'],
    ['Settings', '设置'],
    ['Model', '模型'],
    ['Context', '上下文'],
    ['Tokens', '令牌'],
    ['Cost', '费用'],
    ['Resume', '继续'],
    ['Delete', '删除'],
    ['Rename', '重命名'],
    ['Archive', '归档'],
    ['Fork session', '分支会话'],
    ['Plan: off', '计划：关'],
    ['Plan mode', '计划模式'],
    ['Vibe: off', '氛围：关'],
    ['Goal: off', '目标：关'],
    ['Goal mode', '目标模式'],
    ['1 skill', '1 个技能'],
    ['skills', '技能'],
    ['skill:', '技能：'],
    ['provider', '服务商'],
    ['Provider', '服务商'],
    ['Permission', '权限'],
    ['permission', '权限'],
    // Note: no bare 'session'/'model'/'command' — those fire inside prose
    // (e.g. rotating tips) and leave mixed-language sentences.
    ['compact', '压缩'],
    ['Compacting', '压缩中'],
    ['rate limit', '限额'],
    ['changelog', '更新日志'],
    ['logout', '退出登录'],
    // Keep short last so long phrases win (sort below reorders anyway)
  ] as Array<[string, string]>
).sort((a, b) => b[0].length - a[0].length)

/**
 * Prose fragments for rotating Tip:/advice lines. Applied WITHOUT width
 * padding (tips sit outside boxes) so the sentence stays readable.
 */
const TIP_PROSE: Array<[string, string]> = (
  [
    ['end-to-end encrypted relay link', '端到端加密中继链路'],
    ['Tip: Pair up live:', '提示：实时结对：'],
    ['Pair up live:', '实时结对：'],
    ['Pair up live', '实时结对'],
    ['shares your session through', '分享你的会话，通过'],
    ['shares your session', '分享你的会话'],
    ['shares your', '分享你的'],
    ['a teammate runs', '队友执行'],
    ['teammate runs', '队友执行'],
    ['to watch tool calls stream and prompt the agent from their own omp', '来观看工具调用流，并从他们自己的 omp 里指挥智能体'],
    ['to watch tool calls stream', '来观看工具调用流'],
    ['tool calls stream', '工具调用流'],
    ['prompt the agent from their own', '在他们自己的上指挥智能体'],
    ['from their own omp', '从他们自己的 omp'],
    ['from their own', '从他们自己的'],
    ['encrypted relay', '加密中继'],
    ['relay link', '中继链接'],
    ['spends a saved reset credit', '消耗一条已存的重置额度'],
    ['immediately restore your quota', '立刻恢复你的配额'],
    ['reset credit', '重置额度'],
    ['Codex rate limit', 'Codex 限额'],
    ['rate limit', '限额'],
    ['Check your authentication credentials', '检查你的登录凭据'],
    ['Check file permissions', '检查文件权限'],
    ['Check that the server is running', '确认服务是否在运行'],
    ['Check that the command or URL is correct', '确认命令或 URL 是否正确'],
    ['the package name is from package.json', '包名来自 package.json'],
    ['can differ from the folder name', '可能与文件夹名不同'],
    ['Press Ctrl+C or Esc anytime to cancel', '随时按 Ctrl+C 或 Esc 取消'],
    ['Choose Retry to launch the browser again', '选择「重试」以再次启动浏览器'],
    ['Complete authorization faster next time', '下次更快完成授权'],
    ['Verify the OAuth server is accessible', '确认 OAuth 服务可访问'],
    ['Use `/changelog full` to view the complete changelog.', '用 `/changelog full` 查看完整更新日志。'],
    ['view the complete changelog', '查看完整更新日志'],
    ['complete changelog', '完整更新日志'],
    ['and prompt the agent', '并指挥智能体'],
    ['their own omp', '他们自己的 omp'],
    ['watch tool calls', '观看工具调用'],
    ['Try increasing the timeout', '尝试增大超时时间'],
    ['the URL/port is correct', 'URL/端口正确'],
    ['server is running', '服务正在运行'],
    ['authentication credentials', '登录凭据'],
    ['view-only links', '只读链接'],
    ['browser link', '浏览器链接'],
    ['join URL', '加入链接'],
    ['folder name', '文件夹名'],
    ['package name', '包名'],
  ] as Array<[string, string]>
).sort((a, b) => b[0].length - a[0].length)

/** Word-boundary replace for prose (no width padding). */
function replaceProse(out: string, en: string, zh: string): string {
  if (!en || !zh || en === zh) return out
  const re = new RegExp(`(?<![A-Za-z])${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'g')
  return out.replace(re, zh)
}

/** Translate rotating tips / advice lines without width lock. */
export function translateTipProse(chunk: string): string {
  let out = chunk
  for (const [en, zh] of TIP_PROSE) {
    out = replaceProse(out, en, zh)
  }
  return out
}

// CSI / OSC / other ESC sequences — allowed to sit between any two characters
// of a phrase so color-styled TUI text still matches.
const ANSI = '(?:\\x1b\\[[0-9;:?]*[ -/]*[@-~]|\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)|\\x1b[@-Z\\\\-_])'

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when `phrase` is a pure ASCII word/short token needing word edges. */
function needsWordBoundary(phrase: string): boolean {
  return /^[A-Za-z][A-Za-z0-9 +'/-]*$/.test(phrase) && phrase.length <= 24
}

/** Build a regex that matches `phrase` even when ANSI codes sit between chars.
 *  Spaces inside the phrase are literal — we only allow ANSI (not extra spaces)
 *  between characters, so "LSP" never matches the spaced-out "L S P".
 */
function ansiTolerantRe(phrase: string, wordBound: boolean): RegExp {
  const chars = [...phrase].map(escapeRe)
  const body = chars.join(`(?:${ANSI})*`)
  const core = `(?:${ANSI})*${body}(?:${ANSI})*`
  if (wordBound) {
    // Don't match inside a longer word: "Update" must not hit "Updated".
    return new RegExp(`(?<![A-Za-z])${core}(?![A-Za-z])`, 'g')
  }
  return new RegExp(core, 'g')
}

const reCache = new Map<string, RegExp>()
function phraseRe(phrase: string): RegExp {
  let re = reCache.get(phrase)
  if (!re) {
    re = ansiTolerantRe(phrase, needsWordBoundary(phrase))
    reCache.set(phrase, re)
  }
  return re
}

/**
 * Replace one phrase, preserving display width so TUI boxes stay aligned.
 * Returns null if replacement would overflow the original width (skip).
 */
function replacePhrase(out: string, en: string, zh: string): string {
  if (!en || !zh || en === zh) return out

  const srcW = displayWidth(en)

  // Fast path: contiguous substring
  if (out.includes(en)) {
    const fitted = fitWidth(zh, srcW)
    if (fitted === null) return out
    return out.split(en).join(fitted)
  }

  const re = phraseRe(en)
  re.lastIndex = 0
  if (!re.test(out)) return out
  re.lastIndex = 0

  out = out.replace(re, (match) => {
    const lead = match.match(new RegExp(`^(?:${ANSI}|[ \\t])*`))?.[0] ?? ''
    const trail = match.match(new RegExp(`(?:${ANSI}|[ \\t])*$`))?.[0] ?? ''
    // Strip ANSI when measuring the true source width of the matched text.
    const plain = match.replace(new RegExp(ANSI, 'g'), '')
    const w = displayWidth(plain) || srcW
    const fitted = fitWidth(zh, w)
    if (fitted === null) return match
    return lead + fitted + trail
  })
  return out
}

/**
 * OMP draws rounded TUI chrome (╭╮╰╯). Users want square, axis-aligned
 * frames. Map soft corners onto the single-line box set — same 1-column
 * width, so layout is unchanged.
 */
const CORNERS: Record<string, string> = {
  '╭': '┌',
  '╮': '┐',
  '╰': '└',
  '╯': '┘',
  '⎡': '┌',
  '⎤': '┐',
  '⎣': '└',
  '⎦': '┘',
}

export function squareBoxCorners(chunk: string): string {
  let out = ''
  for (const ch of chunk) {
    out += CORNERS[ch] ?? ch
  }
  return out
}

/**
 * SGR dim (CSI 2 m) paints gray at ~50% of the current color — unreadable
 * on dark chrome (tips, recap). Swap dim for a fixed readable slate gray.
 * CSI 22 m restores normal intensity and is left alone.
 */
const DIM_SGR = /\x1b\[2m/g
const READABLE_DIM = '\x1b[38;2;168;174;186m'

export function softenDim(chunk: string): string {
  return chunk.replace(DIM_SGR, READABLE_DIM)
}

/**
 * Words that must never be swapped inside running English prose
 * (rotating tips, error sentences). UI chrome uses longer phrases instead.
 */
const NEVER_INLINE = new Set([
  'session', 'Session', 'model', 'Model', 'command', 'Command',
  'added', 'changed', 'fixed', 'release', 'releases', 'details', 'history',
  'across', 'skills', 'skill', 'provider', 'Provider',
  'permission', 'Permission',
])

/**
 * Terminal stream overlay: replace known OMP TUI English phrases with Chinese.
 * Handles ANSI color codes that split English words in TUI redraws.
 * Preserves display width so box-drawing columns stay vertical.
 * Also squares rounded corners so every frame line is axis-aligned.
 */
export function translateTerminalChunk(chunk: string): string {
  let out = softenDim(squareBoxCorners(chunk))

  const applyMap = (map: Record<string, string>): void => {
    const keys = Object.keys(map).sort((a, b) => b.length - a.length)
    for (const en of keys) {
      const zh = map[en]
      if (!en || !zh || en === zh) continue
      if (NEVER_INLINE.has(en)) continue
      out = replacePhrase(out, en, zh)
    }
  }

  if (cached) applyMap(cached.map)
  applyMap(Object.fromEntries(TERMINAL_PHRASES))
  // Rotating tips / advice prose — no width lock (outside boxes).
  out = translateTipProse(out)
  return out
}

/** Load pack from main (after IPC available). Safe no-op in tests. */
export async function hydrateOmpLabels(getPack: () => Promise<unknown>): Promise<void> {
  try {
    loadOmpLabelPack(await getPack())
  } catch {
    /* ignore */
  }
}
