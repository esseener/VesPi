import type { AppSettings } from './ipc-contracts'
import { DEFAULT_COUNCIL_CONFIG } from './council-config'
import { DEFAULT_INTERACTION_MODES } from './interaction-modes'
import { DEFAULT_SIDEBAR_WIDTH } from './sidebar-width'
import { VESPI_PRIVATE_OMP_REL } from './vespi'
import { DEFAULT_LANGUAGE } from './i18n'

/**
 * The single source of truth for default app settings. Used by the main process
 * to seed settings.json on first run, and by the renderer's Settings panel for
 * its "Reset to defaults" action and initial field values. Change a default here
 * and it applies everywhere.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  piExecutablePath: VESPI_PRIVATE_OMP_REL,
  piEngine: 'omp',
  defaultArgs: [],
  theme: 'dark',
  ompThemeDark: 'anthracite',
  ompSymbolPreset: 'unicode' as const,
  ompThinkingLevel: 'high' as const,
  language: DEFAULT_LANGUAGE,
  defaultModel: null,

  defaultProvider: null,
  defaultCwd: null,
  fontSize: 16,
  terminalFontSize: 14,
  codeEditorFontSize: 14,
  showThinking: true,
  autoScroll: true,
  // The kernel's own defaults — see shared/interaction-modes.ts for why they
  // are re-declared here rather than read back from it.
  ...DEFAULT_INTERACTION_MODES,
  permissionMode: 'ask-edits',
  permissionRulesAckWorkspaces: [],
  resumeLastSession: true,
  collapsedSessionGroups: [],
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  openToHomeOnLaunch: true,
  runOnStartup: false,
  minimizeToTrayOnClose: false,
  hasSeenTrayHint: false,
  desktopNotifications: true,
  /** Chime when a model turn finishes. */
  completionChime: true,
  /** Peak loudness of that chime, 0-1. 0.5 is already louder than the old fixed chime. */
  completionChimeVolume: 0.5,
  // On by default: the agent gets a browser it can actually drive, and the user
  // gets to watch it. Turning it off leaves the model with its own invisible
  // headless browser.
  agentBrowserEnabled: true,
  // Off, unlike the browser above: this one drives the user's actual desktop —
  // their mouse, their keyboard, whatever window is in front. See computer-mcp.ts.
  agentComputerEnabled: false,
  council: DEFAULT_COUNCIL_CONFIG,
}
