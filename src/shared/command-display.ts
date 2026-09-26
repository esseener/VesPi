import type { AppLanguage } from './i18n'
import { ompLabel } from './omp-labels'

/**
 * Display labels for slash commands. The invocation token (`/compact`, …) stays
 * in the kernel's spelling — only the visible name/description is localized.
 * Unknown names fall back to the raw command so OMP upgrades never hide entries.
 */
const NAME_LABELS: Record<string, { zh: string; en: string }> = {
  compact: { zh: '压缩上下文', en: 'Compact context' },
  clone: { zh: '克隆会话', en: 'Clone session' },
  new: { zh: '新会话', en: 'New session' },
  task: { zh: '启动任务', en: 'Launch task' },
  resume: { zh: '恢复会话', en: 'Resume session' },
  fork: { zh: '分支会话', en: 'Fork session' },
  branch: { zh: '分支', en: 'Branch' },
  timeline: { zh: '时间线', en: 'Timeline' },
  missions: { zh: '任务中心', en: 'Missions' },
  diagnostics: { zh: '诊断', en: 'Diagnostics' },
  settings: { zh: '设置', en: 'Settings' },
  model: { zh: '切换模型', en: 'Switch model' },
  models: { zh: '模型列表', en: 'Models' },
  think: { zh: '思考档位', en: 'Thinking level' },
  thinking: { zh: '思考档位', en: 'Thinking level' },
  fast: { zh: '快速模式', en: 'Fast mode' },
  steer: { zh: '插话模式', en: 'Steering mode' },
  handoff: { zh: '搬运会话', en: 'Handoff' },
  export: { zh: '导出 HTML', en: 'Export HTML' },
  todo: { zh: '待办', en: 'Todos' },
  todos: { zh: '待办', en: 'Todos' },
  retry: { zh: '中止并重试', en: 'Abort & retry' },
  abort: { zh: '中止', en: 'Abort' },
  audio: { zh: '语音输入', en: 'Voice input' },
  goal: { zh: '目标', en: 'Goal' },
  skill: { zh: '技能', en: 'Skill' },
  mcp: { zh: '外部工具', en: 'MCP tools' },
  login: { zh: '登录供应商', en: 'Sign in' },
  stats: { zh: '会话统计', en: 'Session stats' },
  help: { zh: '帮助', en: 'Help' },
  clear: { zh: '清空输入', en: 'Clear input' },
  quit: { zh: '退出', en: 'Quit' },
}

const DESC_LABELS: Record<string, { zh: string; en: string }> = {
  compact: { zh: '释放上下文额度', en: 'Free up context' },
  clone: { zh: '从当前会话开新会话', en: 'Start from this session' },
  new: { zh: '开始新会话', en: 'Start a new session' },
  task: { zh: '在新会话中启动任务', en: 'Launch a task in a new session' },
  resume: { zh: '打开会话列表', en: 'Open session list' },
  fork: { zh: '从消息处分叉', en: 'Fork from a message' },
  branch: { zh: '创建分支', en: 'Create a branch' },
  timeline: { zh: '查看活动时间线', en: 'Open activity timeline' },
  missions: { zh: '全局任务与工作流', en: 'Global missions & workflows' },
  diagnostics: { zh: '内核 / 供应商 / 日志', en: 'Kernel, providers, log' },
  settings: { zh: '外观与行为设置', en: 'Appearance & behavior' },
  model: { zh: '切换当前模型', en: 'Switch the current model' },
  models: { zh: '浏览可用模型', en: 'Browse models' },
  think: { zh: '关 / 低 / 中 / 高', en: 'Off / low / med / high' },
  thinking: { zh: '关 / 低 / 中 / 高', en: 'Off / low / med / high' },
  fast: { zh: '降低思考档换取速度', en: 'Trade thinking for speed' },
  steer: { zh: '消息投递三档', en: 'Steering / follow-up / interrupt' },
  handoff: { zh: '交接当前上下文', en: 'Hand off this context' },
  export: { zh: '导出本回合报告', en: 'Export this turn as HTML' },
  todo: { zh: '写入待办列表', en: 'Write todos' },
  todos: { zh: '写入待办列表', en: 'Write todos' },
  retry: { zh: '中止当前回合并重试', en: 'Abort turn and retry' },
  abort: { zh: '中止当前回合', en: 'Abort the current turn' },
  audio: { zh: '开 / 关语音输入', en: 'Toggle voice input' },
  goal: { zh: '查看 / 继续 / 放弃', en: 'View / resume / drop' },
  skill: { zh: '按名称调用技能', en: 'Run a skill by name' },
  mcp: { zh: '查看外部工具', en: 'List MCP tools' },
  login: { zh: '供应商登录', en: 'Provider sign-in' },
  stats: { zh: 'tokens 与费用', en: 'Tokens & cost' },
  help: { zh: '命令说明', en: 'Command help' },
  clear: { zh: '清空命令条', en: 'Clear the composer' },
  quit: { zh: '退出应用', en: 'Quit the app' },
}

function pick(
  table: Record<string, { zh: string; en: string }>,
  key: string,
  language: AppLanguage,
): string | null {
  const row = table[key]
  if (!row) return null
  return language === 'en' ? row.en : row.zh
}

/** Strip `/` and `skill:` prefixes so `/skill:plan` and `skill:plan` share a row. */
function commandKey(name: string): string {
  return name.replace(/^\//, '').replace(/^skill:/i, '').trim().toLowerCase()
}

export function commandDisplayLabel(name: string, language: AppLanguage): string {
  const zh = pick(NAME_LABELS, commandKey(name), language)
  if (zh) return zh
  // 译包（LAYA / 内核升级对账）优先于原文
  return ompLabel(name)
}

export function commandDisplayDescription(
  name: string,
  description: string,
  language: AppLanguage,
): string {
  const zh = pick(DESC_LABELS, commandKey(name), language)
  if (zh) return zh
  return ompLabel(description) !== description ? ompLabel(description) : description
}

export const COMMAND_SOURCE_LABELS: Record<string, { zh: string; en: string }> = {
  skill: { zh: '技能', en: 'skill' },
  prompt: { zh: '提示词', en: 'prompt' },
  builtin: { zh: '命令', en: 'command' },
  extension: { zh: '扩展', en: 'extension' },
  other: { zh: '其他', en: 'other' },
}

export function commandSourceLabel(source: string, language: AppLanguage): string {
  const row = COMMAND_SOURCE_LABELS[source]
  if (!row) return source
  return language === 'en' ? row.en : row.zh
}
