/**
 * Merge-write `~/.omp/profiles/vespi/agent/config.yml`.
 * Never clobber unrelated keys (modelRoles, setupVersion, theme, …).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { getOmpSessionsRoot } from './pi-paths'

export function ompAgentConfigPath(): string {
  return join(dirname(getOmpSessionsRoot()), 'config.yml')
}

function agentDir(): string {
  return dirname(ompAgentConfigPath())
}

/** Parse the tiny subset of YAML OMP uses (flat + one nested level). */
function parseYamlMap(text: string): Record<string, string | Record<string, string>> {
  const root: Record<string, string | Record<string, string>> = {}
  let section: string | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '')
    if (!line.trim()) continue
    const sec = /^([A-Za-z_][\w-]*):\s*$/.exec(line)
    if (sec) {
      section = sec[1]
      root[section] = {}
      continue
    }
    const kv = /^\s+([A-Za-z_][\w-]*):\s*(\S+)\s*$/.exec(line)
    if (kv && section && typeof root[section] === 'object') {
      ;(root[section] as Record<string, string>)[kv[1]] = kv[2]
      continue
    }
    const flat = /^([A-Za-z_][\w-]*):\s*(\S+)\s*$/.exec(line)
    if (flat) {
      section = null
      root[flat[1]] = flat[2]
    }
  }
  return root
}

function serializeYamlMap(map: Record<string, string | Record<string, string>>): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(map)) {
    if (value && typeof value === 'object') {
      lines.push(`${key}:`)
      for (const [k, v] of Object.entries(value)) {
        lines.push(`  ${k}: ${v}`)
      }
    } else {
      lines.push(`${key}: ${value}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

export interface OmpProfilePatch {
  /** modelRoles.default — e.g. "ML-dp/deepseek-v4.1-flash" */
  defaultModel?: string
  /** thinking.defaultLevel */
  thinkingLevel?: string
  /** theme.dark / theme.light / symbolPreset (from appearance) */
  themeDark?: string
  themeLight?: string
  symbolPreset?: string
}

/**
 * Apply a patch onto config.yml in place. Creates the file if missing.
 * Returns the map that was written.
 */
export function patchOmpProfileConfig(patch: OmpProfilePatch): Record<string, string | Record<string, string>> {
  const path = ompAgentConfigPath()
  let map: Record<string, string | Record<string, string>> = {}
  if (existsSync(path)) {
    try {
      map = parseYamlMap(readFileSync(path, 'utf-8'))
    } catch {
      map = {}
    }
  }

  if (patch.defaultModel) {
    const roles = (typeof map.modelRoles === 'object' && map.modelRoles) ? { ...map.modelRoles } : {}
    roles.default = patch.defaultModel
    map.modelRoles = roles
  }
  if (patch.thinkingLevel) {
    const thinking = (typeof map.thinking === 'object' && map.thinking) ? { ...map.thinking } : {}
    thinking.defaultLevel = patch.thinkingLevel
    map.thinking = thinking
  }
  if (patch.themeDark || patch.themeLight) {
    const theme = (typeof map.theme === 'object' && map.theme) ? { ...map.theme } : {}
    if (patch.themeDark) theme.dark = patch.themeDark
    if (patch.themeLight) theme.light = patch.themeLight
    map.theme = theme
  }
  if (patch.symbolPreset) {
    map.symbolPreset = patch.symbolPreset
  }

  mkdirSync(agentDir(), { recursive: true })
  writeFileSync(path, serializeYamlMap(map), 'utf-8')
  return map
}
