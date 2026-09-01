import type { AppLanguage } from '../../shared/i18n'
import { t, type MessageKey } from '../../shared/i18n'

const POOL: MessageKey[] = [
  'exampleExplain',
  'exampleTodos',
  'exampleTests',
  'exampleDebug',
  'exampleReadme',
  'exampleGitStatus',
  'exampleRecentDiff',
  'exampleCleanup',
  'exampleTypes',
  'examplePerf',
  'exampleSecurity',
  'exampleApi',
  'exampleUiPolish',
  'exampleDeps',
  'exampleConfig',
  'exampleFirstTask',
]

const BIAS: Array<{ test: RegExp; keys: MessageKey[] }> = [
  { test: /\.(tsx|jsx|vue|svelte|css|html)$/i, keys: ['exampleUiPolish', 'exampleTypes'] },
  { test: /(package\.json|pnpm-lock|yarn\.lock|bun\.lock)/i, keys: ['exampleDeps', 'exampleConfig'] },
  { test: /(cargo\.toml|go\.mod|pyproject|requirements\.txt|pom\.xml)/i, keys: ['exampleConfig', 'exampleTests'] },
  { test: /(\.git|git)/i, keys: ['exampleGitStatus', 'exampleRecentDiff'] },
]

function hashSeed(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed: number): () => number {
  let value = seed
  return () => {
    value += 0x6D2B79F5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const next = items.slice()
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const tmp = next[i]
    next[i] = next[j]
    next[j] = tmp
  }
  return next
}

export function pickEmptyChatSuggestions(options: {
  language: AppLanguage
  seed: string
  workspacePath?: string | null
  count?: number
}): string[] {
  const count = options.count ?? 4
  const random = mulberry32(hashSeed(`${options.language}:${options.seed}`))
  const path = options.workspacePath ?? ''
  const biased = BIAS.flatMap((rule) => (rule.test.test(path) ? rule.keys : []))
  const unique = [...new Set([...biased, ...shuffle(POOL, random)])]
  return unique.slice(0, count).map((key) => t(options.language, key))
}
