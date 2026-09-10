import { join } from 'path'
import type { InstalledPackage } from '../shared/ipc-contracts'
import { VESPI_PROFILE } from '../shared/vespi'

export const OMP_PLUGIN_DOCS_URL = 'https://github.com/can1357/oh-my-pi'

export function ompPluginDirectory(homeDir: string): string {
  return join(homeDir, '.omp', 'profiles', VESPI_PROFILE, 'plugins')
}

export function ompPluginArgs(
  action: 'list' | 'install' | 'uninstall' | 'upgrade',
  spec?: string,
): string[] {
  const args = ['--profile', VESPI_PROFILE, 'plugin', action]
  if (spec) args.push(spec)
  if (action === 'list') args.push('--json')
  if (action === 'install') args.push('--scope=user')
  return args
}

/**
 * OMP returns an object keyed by source (currently npm and marketplace). Keep
 * parsing tolerant because plugin metadata has changed between OMP releases.
 */
export function parseOmpPluginList(
  output: string,
  pluginDirectory: string,
): InstalledPackage[] {
  const parsed = parseJsonObject(output)
  if (!parsed) return []

  const packages: InstalledPackage[] = []
  const seen = new Set<string>()
  for (const [sourceKind, value] of Object.entries(parsed)) {
    if (!Array.isArray(value)) continue
    for (const entry of value) {
      const pkg = normalizePluginEntry(entry, sourceKind, pluginDirectory)
      if (!pkg || seen.has(pkg.source)) continue
      seen.add(pkg.source)
      packages.push(pkg)
    }
  }
  return packages
}

function parseJsonObject(output: string): Record<string, unknown> | null {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(output.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function normalizePluginEntry(
  entry: unknown,
  sourceKind: string,
  pluginDirectory: string,
): InstalledPackage | null {
  if (typeof entry === 'string') {
    return {
      name: packageName(entry),
      source: entry,
      type: 'extension',
      version: packageVersion(entry),
      path: pluginDirectory,
    }
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null

  const record = entry as Record<string, unknown>
  const source = firstString(record, ['source', 'spec', 'package', 'id', 'name'])
  if (!source) return null
  const name = firstString(record, ['name', 'package', 'id']) ?? packageName(source)
  const version = firstString(record, ['version']) ?? packageVersion(source)
  const path = firstString(record, ['path', 'location']) ?? pluginDirectory
  return {
    name,
    source,
    type: sourceKind === 'marketplace' ? 'extension' : 'extension',
    version,
    path,
  }
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim()
  }
  return null
}

function packageName(source: string): string {
  const npm = source.match(/^npm:(@?[^@]+)/)
  if (npm) return npm[1]
  const github = source.match(/github\.com\/([^/]+\/[^/@]+)/)
  if (github) return github[1]
  return source.split('/').pop() ?? source
}

function packageVersion(source: string): string | null {
  const match = source.match(/@([^/]+)$/)
  return match ? match[1] : null
}
