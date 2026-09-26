/**
 * OMP profile appearance config (theme.dark / theme.light / symbolPreset).
 * Written next to models.yml under the vespi profile so TUI and shell share one look.
 */
export const OMP_DARK_THEMES = [
  'anthracite',
  'titanium',
  'darkTitanium',
  'amethyst',
  'ember',
  'steel',
  'gruvbox',
  'dracula',
  'nord',
  'coal',
  'basalt',
  'charcoal',
  'erosion',
] as const
export type OmpDarkTheme = (typeof OMP_DARK_THEMES)[number]

export interface OmpAppearance {
  themeDark: OmpDarkTheme | string
  themeLight: string
  symbolPreset: 'unicode' | 'nerd' | 'ascii'
  /** thinking.defaultLevel when the model supports efforts */
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
}

export const DEFAULT_OMP_APPEARANCE: OmpAppearance = {
  themeDark: 'anthracite',
  themeLight: 'light',
  symbolPreset: 'unicode',
  thinkingLevel: 'high',
}

/** Minimal YAML for OMP config overlay (no deps). */
export function buildOmpAppearanceYaml(a: OmpAppearance): string {
  return [
    '# Written by VesPi — OMP appearance',
    'theme:',
    `  dark: ${a.themeDark}`,
    `  light: ${a.themeLight}`,
    `symbolPreset: ${a.symbolPreset}`,
    'thinking:',
    `  defaultLevel: ${a.thinkingLevel ?? 'high'}`,
    '',
  ].join('\n')
}
