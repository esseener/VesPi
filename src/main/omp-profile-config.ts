/** Update only the requested fields in the OMP profile, preserving full YAML. */
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { isMap, parse, parseDocument } from 'yaml'
import type { AppSettings } from '../shared/ipc-contracts'
import { getOmpSessionsRoot } from './pi-paths'

export function ompAgentConfigPath(): string {
  return join(dirname(getOmpSessionsRoot()), 'config.yml')
}

export function readOmpProfileSettings(): Partial<AppSettings> {
  const file = ompAgentConfigPath()
  if (!existsSync(file)) return {}
  const config = parse(readFileSync(file, 'utf-8'))
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid OMP profile')
  const result: Partial<AppSettings> = {}
  if (typeof config.theme?.dark === 'string') result.ompThemeDark = config.theme.dark
  if (typeof config.symbolPreset === 'string') result.ompSymbolPreset = config.symbolPreset
  if (typeof config.defaultThinkingLevel === 'string') result.ompThinkingLevel = config.defaultThinkingLevel
  if (typeof config.hideThinkingBlock === 'boolean') result.showThinking = !config.hideThinkingBlock
  if (['all', 'one-at-a-time'].includes(config.steeringMode)) result.steeringMode = config.steeringMode
  if (['all', 'one-at-a-time'].includes(config.followUpMode)) result.followUpMode = config.followUpMode
  if (['immediate', 'wait'].includes(config.interruptMode)) result.interruptMode = config.interruptMode
  return result
}

export interface OmpProfilePatch {
  defaultModel?: string
  thinkingLevel?: string
  themeDark?: string
  themeLight?: string
  symbolPreset?: string
  hideThinkingBlock?: boolean
  steeringMode?: string
  followUpMode?: string
  interruptMode?: string
}

export function patchOmpConfigText(text: string, patch: OmpProfilePatch): string {
  for (const [key, allowed] of Object.entries({
    thinkingLevel: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto'],
    symbolPreset: ['unicode', 'nerd', 'ascii'],
    steeringMode: ['all', 'one-at-a-time'],
    followUpMode: ['all', 'one-at-a-time'],
    interruptMode: ['immediate', 'wait'],
  })) {
    const value = patch[key as keyof OmpProfilePatch]
    if (value !== undefined && (typeof value !== 'string' || !allowed.includes(value))) throw new Error(`Invalid OMP ${key}`)
  }
  const document = parseDocument(text.trim() ? text : '{}\n')
  if (document.errors.length) throw new Error(`Invalid OMP config: ${document.errors[0].message}`)
  if (document.contents !== null && !isMap(document.contents)) throw new Error('OMP config must be a YAML mapping')
  if (patch.defaultModel) document.setIn(['modelRoles', 'default'], patch.defaultModel)
  if (patch.thinkingLevel) {
    document.set('defaultThinkingLevel', patch.thinkingLevel)
    // Remove only the obsolete field written by earlier VesPi versions.
    if (isMap(document.get('thinking'))) document.deleteIn(['thinking', 'defaultLevel'])
  }
  if (patch.themeDark) document.setIn(['theme', 'dark'], patch.themeDark)
  if (patch.themeLight) document.setIn(['theme', 'light'], patch.themeLight)
  if (patch.symbolPreset) document.set('symbolPreset', patch.symbolPreset)
  if (patch.hideThinkingBlock !== undefined) document.set('hideThinkingBlock', patch.hideThinkingBlock)
  for (const key of ['steeringMode', 'followUpMode', 'interruptMode'] as const) {
    if (patch[key]) document.set(key, patch[key])
  }
  return document.toString()
}

export function patchOmpProfileConfig(patch: OmpProfilePatch): void {
  const file = ompAgentConfigPath()
  const text = patchOmpConfigText(existsSync(file) ? readFileSync(file, 'utf-8') : '', patch)
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, text, 'utf-8')
  renameSync(temporary, file)
}
