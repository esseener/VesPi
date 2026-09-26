/**
 * OMP 汉化流水线（Laya = NandhaKishorM/laya 决策引擎）
 *
 * Laya 不负责「生成译文」，负责从候选里 **choice / score / yes-no** 选出最优中文。
 *
 * 流程（内核升级后）：
 *   1. 对账抽取 OMP 英文串（工具名 / 菜单 / 提示 / 错误模板）
 *   2. 为每条生成候选中文（内置词表 + 规则 + 可选生成器）
 *   3. 调 Laya：typed decision 选最佳译名（multilingual checkpoint）
 *   4. 写 omp-labels.zh.json，界面 ompLabel() 即用
 *
 * Laya 接入（二选一，均随包/本机，不进全局 PATH）：
 *   A. HTTP：`pip install "laya[serve]"` 后本机 serve（见 resources/laya/README.md）
 *   B. CLI：resources/laya/laya.cmd 传入决策请求 JSON
 *
 * 无 Laya 时：只用词表+规则，仍可出中文；有 Laya 时自动择优。
 */
import { ompLabel } from './omp-labels'
import { localTranslate } from './laya-translate'

export interface LabelCandidate {
  source: string
  candidates: string[]
}

export interface LayaDecision {
  choice: string
  score?: number
}

/** 常见 OMP 界面词 → 中文候选（规则层，不依赖模型） */
const RULE_CANDIDATES: Record<string, string[]> = {
  'Read file': ['读取文件', '读文件'],
  'Write file': ['写入文件', '创建文件'],
  'Edit file': ['编辑文件'],
  'Run command': ['执行命令', '运行命令'],
  Search: ['搜索'],
  'Fetch URL': ['获取网址', '抓取链接'],
  'List files': ['列出文件'],
  'Delegate subagent': ['委派子智能体'],
  'Sign in': ['登录', '登入'],
  'Set up your providers': ['配置服务商', '设置供应商'],
  'Press Esc when you\'re done.': ['完成后按 Esc。'],
  'Select provider to login': ['选择要登录的服务商'],
  'Type to search': ['输入以搜索'],
  Loading: ['加载中'],
  Error: ['错误'],
  Warning: ['警告'],
  Cancel: ['取消'],
  Confirm: ['确认'],
  Done: ['完成'],
  Help: ['帮助'],
  Settings: ['设置'],
  Model: ['模型'],
  Thinking: ['思考'],
  'New session': ['新会话'],
  'Compact context': ['压缩上下文'],
}

export function candidatesFor(source: string): string[] {
  const direct = RULE_CANDIDATES[source]
  if (direct) return direct
  // 短词：可启发式
  if (/^\/[a-z]+$/i.test(source)) return [source]
  return []
}

/**
 * 用 Laya 对「单条多候选」做 choice。失败则退回第一候选 / 原文。
 * 请求形状对齐 laya typed decisions: choice + options.
 */
export async function layaPickLabel(
  source: string,
  candidates: string[],
  decide: (req: { state: string; choices: string[] }) => Promise<LayaDecision | null>,
): Promise<string> {
  if (candidates.length === 0) return ompLabel(source)
  if (candidates.length === 1) return candidates[0]
  try {
    const res = await decide({
      state: `UI label translation. English: ${source}. Pick the best Simplified Chinese UI label.`,
      choices: candidates,
    })
    if (res?.choice && candidates.includes(res.choice)) return res.choice
  } catch {
    /* fall through */
  }
  return candidates[0]
}

/** 批量：规则候选 + 可选 Laya 决策 + 可选生成器补空 */
export async function buildLabelPack(
  sources: string[],
  opts: {
    decide?: (req: { state: string; choices: string[] }) => Promise<LayaDecision | null>
  } = {},
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const missing: string[] = []
  for (const s of sources) {
    const cands = candidatesFor(s)
    if (cands.length > 0) {
      out[s] = opts.decide
        ? await layaPickLabel(s, cands, opts.decide)
        : cands[0]
    } else {
      missing.push(s)
    }
  }
  // 缺口：可选生成器（Ollama 等）出草稿，再 Laya 择优
  if (missing.length > 0) {
    const drafts = await localTranslate(missing)
    for (const s of missing) {
      const d = drafts[s]
      out[s] = d && d !== s ? d : ompLabel(s)
    }
  }
  return out
}
