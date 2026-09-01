import type { PermissionMode } from '../../../shared/ipc-contracts'
import { DEFAULT_LANGUAGE, t, type AppLanguage } from '../../../shared/i18n'

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'ask-edits'

export const PERMISSION_MODE_OPTIONS: Array<{
  value: PermissionMode
  labelKey: 'permPlan' | 'permAskEdits' | 'permAskCommands' | 'permTrusted'
  descriptionKey: 'permPlanHint' | 'permAskEditsHint' | 'permAskCommandsHint' | 'permTrustedHint'
  tone: 'safe' | 'review' | 'command' | 'trusted'
}> = [
  {
    value: 'plan-readonly',
    labelKey: 'permPlan',
    descriptionKey: 'permPlanHint',
    tone: 'safe',
  },
  {
    value: 'ask-edits',
    labelKey: 'permAskEdits',
    descriptionKey: 'permAskEditsHint',
    tone: 'review',
  },
  {
    value: 'ask-commands',
    labelKey: 'permAskCommands',
    descriptionKey: 'permAskCommandsHint',
    tone: 'command',
  },
  {
    value: 'trusted',
    labelKey: 'permTrusted',
    descriptionKey: 'permTrustedHint',
    tone: 'trusted',
  },
]

const PERMISSION_MODE_VALUES = new Set<PermissionMode>(
  PERMISSION_MODE_OPTIONS.map((option) => option.value)
)

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && PERMISSION_MODE_VALUES.has(value as PermissionMode)
}

export function getPermissionModeLabel(mode: PermissionMode, language?: AppLanguage | null): string {
  const option = PERMISSION_MODE_OPTIONS.find((item) => item.value === mode)
  return t(language ?? DEFAULT_LANGUAGE, option?.labelKey ?? 'permAskEdits')
}

export function getPermissionModeDescription(mode: PermissionMode, language?: AppLanguage | null): string {
  const option = PERMISSION_MODE_OPTIONS.find((item) => item.value === mode)
  return t(language ?? DEFAULT_LANGUAGE, option?.descriptionKey ?? 'permAskEditsHint')
}
