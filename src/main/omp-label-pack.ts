/**
 * OMP label pack: English TUI strings → Chinese.
 * Always seeds from the built-in dict; LAYA (optional) may refine later.
 * Writes omp-labels.zh.json under userData; renderer loads it via omp-labels.ts.
 */
import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { TERMINAL_PHRASES } from '../shared/omp-labels'

/** Guaranteed Chinese for OMP welcome / setup / status chrome. */
export const OMP_SEED_DICT: Record<string, string> = {
  ...Object.fromEntries(TERMINAL_PHRASES),
  'Welcome to Oh My Pi': '欢迎使用 Oh My Pi',
  'Sign in with': '使用以下账号登录',
  'MCP Server': 'MCP 服务',
  Provider: '服务商',
  provider: '服务商',
  // Deliberately NO bare session/model/command — those leak into prose tips.
  Sessions: '会话',
  sessions: '会话',
  Tools: '工具',
  Tool: '工具',
  Files: '文件',
  File: '文件',
  Workspace: '工作区',
  Workspaces: '工作区',
  Permission: '权限',
  Permissions: '权限',
  Allow: '允许',
  Deny: '拒绝',
  Ask: '询问',
  Yes: '是',
  No: '否',
  OK: '确定',
  Apply: '应用',
  Reset: '重置',
  Default: '默认',
  Enabled: '已启用',
  Disabled: '已禁用',
  Running: '运行中',
  Stopped: '已停止',
  Failed: '失败',
  Success: '成功',
  Completed: '已完成',
  Working: '工作中',
  Idle: '空闲',
  Connected: '已连接',
  Starting: '启动中',
  'Please wait': '请稍候',
  'No results': '无结果',
  'No sessions': '无会话',
  'Not found': '未找到',
  About: '关于',
  'Check for updates': '检查更新',
  Download: '下载',
  Open: '打开',
  Close: '关闭',
  Send: '发送',
  Stop: '停止',
  Retry: '重试',
  Skip: '跳过',
  'Try again': '再试一次',
  Error: '错误',
  Warning: '警告',
  'Read file': '读取文件',
  'Write file': '写入文件',
  'Edit file': '编辑文件',
  'Run command': '执行命令',
  'Fetch URL': '获取网址',
  'List files': '列出文件',
  'Delegate subagent': '委派子智能体',
  'Compact context': '压缩上下文',
  'New Chat': '新对话',
  'Type a message': '输入消息',
  'Type a command': '输入命令',
  'Type to filter': '输入以筛选',
  'Slash commands': '斜杠命令',
  'Command palette': '命令面板',
  'Toggle terminal': '切换终端',
  'Toggle sidebar': '切换侧栏',
  'Open settings': '打开设置',
  'Model settings': '模型设置',
  'Appearance settings': '外观设置',
  'Behavior settings': '行为设置',
  'Font size': '字号',
  'Terminal font size': '终端字号',
  'Show thinking': '显示思考',
  'Auto scroll': '自动滚动',
  'Permission mode': '权限模式',
  'Plan mode': '计划模式',
  'Read-only mode': '只读模式',
  'Kernel update': '内核更新',
  'UI update': '界面更新',
  'Update available': '有可用更新',
  'Up to date': '已是最新',
  'Install update': '安装更新',
  'Restart to apply': '重启以应用',
  Later: '稍后',
  Dismiss: '关闭',
  Copied: '已复制',
  'Delete session': '删除会话',
  'Rename session': '重命名会话',
  'Fork session': '分支会话',
  'Resume session': '恢复会话',
  Diagnostics: '诊断',
  Packages: '包',
  Skills: '技能',
  Notes: '笔记',
  Stats: '统计',
  Home: '首页',
  Chat: '对话',
  Terminal: '终端',
  Diff: '差异',
  Timeline: '时间线',
}

export interface LabelPack {
  kernel: string
  map: Record<string, string>
}

function packDir(): string {
  try {
    return app.getPath('userData')
  } catch {
    return process.cwd()
  }
}

export function labelPackPath(): string {
  return join(packDir(), 'omp-labels.zh.json')
}

/** Read the pack file from disk (if any). */
export function loadPackFile(): LabelPack | null {
  try {
    const p = labelPackPath()
    if (!existsSync(p)) return null
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<LabelPack>
    if (!raw || typeof raw !== 'object' || !raw.map || typeof raw.map !== 'object') return null
    return {
      kernel: typeof raw.kernel === 'string' ? raw.kernel : '',
      map: raw.map as Record<string, string>,
    }
  } catch {
    return null
  }
}

function writePackFile(pack: LabelPack): boolean {
  try {
    mkdirSync(packDir(), { recursive: true })
    writeFileSync(labelPackPath(), JSON.stringify(pack, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * Seed-only rebuild: merge previous pack over seed, keep hard seed phrases.
 * Used when LAYA is unavailable.
 */
export function readOrSeedPack(kernelVersion = ''): LabelPack {
  const prev = loadPackFile()
  const map: Record<string, string> = { ...OMP_SEED_DICT, ...(prev?.map ?? {}) }
  for (const k of Object.keys(OMP_SEED_DICT)) map[k] = OMP_SEED_DICT[k]
  const pack: LabelPack = { kernel: kernelVersion || prev?.kernel || '', map }
  writePackFile(pack)
  return pack
}

/**
 * Rebuild the pack. Currently same as seed merge; LAYA refinement can hook in
 * later without changing this contract. Returns a Promise so callers can
 * .catch() (kernel install path).
 */
export async function rebuildOmpLabelPack(kernelVersion = ''): Promise<LabelPack> {
  return readOrSeedPack(kernelVersion)
}
