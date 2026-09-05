import { t, type AppLanguage, type MessageKey } from '../../shared/i18n'
import { toolLabel } from './message-grouping'

const TOOL_NAME_KEYS: Record<string, MessageKey> = {
  'Run command': 'toolRunCommand',
  Search: 'toolSearch',
  'Fetch URL': 'toolFetchUrl',
  'Edit file': 'toolEditFile',
  'Write file': 'toolWriteFile',
  'List files': 'toolListFiles',
  'Read file': 'toolReadFile',
  'Delegate subagent': 'toolDelegate',
}

const TOOL_ARG_KEYS: Record<string, MessageKey> = {
  'Fetch URL': 'toolFetchedArg',
  'Read file': 'toolReadArg',
  'Run command': 'toolRanCommand',
  'Edit file': 'toolEditedArg',
  'Write file': 'toolCreatedArg',
  Search: 'toolSearchedArg',
  'List files': 'toolListedArg',
}

const TOOL_ONE_KEYS: Record<string, MessageKey> = {
  'Fetch URL': 'toolFetchedAUrl',
  'Read file': 'toolReadAFile',
  'Run command': 'toolRanACommand',
  'Edit file': 'toolEditedAFile',
  'Write file': 'toolCreatedAFile',
  Search: 'toolSearchedAQuery',
  'List files': 'toolListedALocation',
}

export function localizeToolName(language: AppLanguage, name: string): string {
  const label = toolLabel(name)
  const key = TOOL_NAME_KEYS[label]
  return key ? t(language, key) : label
}

export function localizeToolCallLabel(
  language: AppLanguage,
  name: string,
  englishLabel: string,
): string {
  const label = toolLabel(name)
  const argKey = TOOL_ARG_KEYS[label]
  if (!argKey) return englishLabel
  const prefix = {
    'Fetch URL': 'Fetched ',
    'Read file': 'Read ',
    'Run command': 'Ran ',
    'Edit file': 'Edited ',
    'Write file': 'Created ',
    Search: 'Searched ',
    'List files': 'Listed ',
  }[label]
  if (prefix && englishLabel.startsWith(prefix)) {
    const arg = englishLabel.slice(prefix.length)
    if (arg && !arg.startsWith('a ')) return t(language, argKey, { arg })
  }
  const oneKey = TOOL_ONE_KEYS[label]
  return oneKey ? t(language, oneKey) : englishLabel
}

const GROUP_ONE: Record<string, MessageKey> = {
  Fetched: 'toolFetchedAUrl',
  Read: 'toolReadAFile',
  Ran: 'toolRanACommand',
  Edited: 'toolEditedAFile',
  Created: 'toolCreatedAFile',
  Searched: 'toolSearchedAQuery',
  Listed: 'toolListedALocation',
}

const GROUP_MANY: Record<string, MessageKey> = {
  Fetched: 'toolFetchedNUrls',
  Read: 'toolReadNFiles',
  Ran: 'toolRanNCommands',
  Edited: 'toolEditedNFiles',
  Created: 'toolCreatedNFiles',
  Searched: 'toolSearchedNQueries',
  Listed: 'toolListedNLocations',
}

const GROUP_ONE_GENERIC: Record<string, MessageKey> = {
  command: 'toolRanACommand',
  tool: 'toolRanATool',
}

const GROUP_MANY_GENERIC: Record<string, MessageKey> = {
  commands: 'toolRanNCommands',
  tools: 'toolRanNTools',
}

function localizeGroupPart(language: AppLanguage, part: string): string {
  const trimmed = part.trim()
  const one = /^(Fetched|Read|Ran|Edited|Created|Searched|Listed) a (\w+)$/.exec(trimmed)
  if (one) {
    const verb = one[1]
    const noun = one[2]
    if (verb === 'Ran') {
      const key = GROUP_ONE_GENERIC[noun]
      if (key) return t(language, key)
    }
    const key = GROUP_ONE[verb]
    if (key) return t(language, key)
  }
  const many = /^(Fetched|Read|Ran|Edited|Created|Searched|Listed) (\d+) (\w+)$/.exec(trimmed)
  if (many) {
    const verb = many[1]
    const n = many[2]
    const noun = many[3]
    if (verb === 'Ran') {
      const key = GROUP_MANY_GENERIC[noun]
      if (key) return t(language, key, { n })
    }
    const key = GROUP_MANY[verb]
    if (key) return t(language, key, { n })
  }
  return trimmed
}

export function localizeToolGroupTitle(language: AppLanguage, title: string): string {
  return title
    .split(', ')
    .map((part) => localizeGroupPart(language, part))
    .join(t(language, 'toolGroupJoin'))
}
