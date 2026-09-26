/**
 * Local translation backend for OMP string packs.
 *
 * Name "LAYA" in product notes = user's preferred local model. Implementation
 * talks to a generic local endpoint so any bundled/runtime model can plug in:
 *
 *   1) Ollama-compatible HTTP  POST /api/generate  {model, prompt, stream:false}
 *   2) Or CLI: resources/laya/laya.cmd --translate-json (stdin array → stdout map)
 *
 * Discovery order: env LAYA_URL / LAYA_MODEL → localhost:11434 (Ollama) → laya.cmd.
 * Never a global install; everything lives under the app / machine local only.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'

export interface LocalTranslatorConfig {
  /** e.g. http://127.0.0.1:11434 */
  baseUrl?: string
  /** e.g. qwen2.5:7b-instruct */
  model?: string
}

function bundledLayaDir(): string | null {
  const res = (process as { resourcesPath?: string }).resourcesPath
  const candidates = [
    res ? join(res, 'laya') : null,
    join(process.cwd(), 'resources', 'laya'),
    join(process.cwd(), '..', 'resources', 'laya'),
  ].filter((p): p is string => Boolean(p))
  for (const dir of candidates) if (existsSync(dir)) return dir
  return null
}

function promptForBatch(texts: string[]): string {
  return [
    '你是术语一致的界面翻译。把下列 JSON 字符串数组译成简体中文界面文案。',
    '规则：代码/命令/路径/模型名保持原样；返回 JSON 对象，键为原文，值为译文；不要解释。',
    'JSON 输入：',
    JSON.stringify(texts),
  ].join('\n')
}

/** Best-effort batch translate. Empty map = no backend available. */
export async function localTranslate(
  texts: string[],
  cfg: LocalTranslatorConfig = {},
): Promise<Record<string, string>> {
  if (texts.length === 0) return {}

  // 1) Ollama-style HTTP
  const base = cfg.baseUrl ?? process.env.LAYA_URL ?? 'http://127.0.0.1:11434'
  const model = cfg.model ?? process.env.LAYA_MODEL ?? 'qwen2.5:7b-instruct'
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: promptForBatch(texts),
        stream: false,
        format: 'json',
      }),
    })
    if (res.ok) {
      const data = (await res.json()) as { response?: string }
      const parsed = JSON.parse(data.response ?? '{}') as Record<string, string>
      return parsed
    }
  } catch {
    /* fall through */
  }

  // 2) CLI shim
  const dir = bundledLayaDir()
  if (dir) {
    const bin = join(dir, process.platform === 'win32' ? 'laya.cmd' : 'laya')
    if (existsSync(bin)) {
      return new Promise((resolve) => {
        const child = spawn(bin, ['--translate-json'], { stdio: ['pipe', 'pipe', 'ignore'] })
        let out = ''
        child.stdout.on('data', (d) => {
          out += String(d)
        })
        child.on('close', () => {
          try {
            resolve(JSON.parse(out) as Record<string, string>)
          } catch {
            resolve({})
          }
        })
        child.stdin.write(JSON.stringify(texts))
        child.stdin.end()
      })
    }
  }
  return {}
}
