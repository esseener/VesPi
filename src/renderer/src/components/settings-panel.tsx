import { useAppStore } from '../store'
import { DEFAULT_AGENT_ENGINE_LABEL, agentEngineLabel } from '../../../shared/agent-engine-label'
import { useState, useEffect, useRef, useCallback } from 'react'
import { clsx } from 'clsx'
import type {
  AppSettings,
  PermissionMode,
  CouncilConfig,
  PermissionRule,
  PermissionRulesScope,
  PermissionRulesWorkspaceStatus,
} from '../../../shared/ipc-contracts'
import type { ThemeFile } from '../../../shared/theme/theme-file'
import { Settings, RotateCcw } from 'lucide-react'
import { ThemedSelect } from './themed-select'
import { DEFAULT_SETTINGS } from '../../../shared/default-settings'
import { PermissionSelector } from './permission-selector'
import { DEFAULT_LANGUAGE, t, type AppLanguage } from '../../../shared/i18n'

import { PermissionRulesEditor } from './permission-rules-editor'
import { validateRuleList, shouldPersistScope } from './permission-rules-editor-helpers'
import { applyTheme, getRegisteredThemes, registerThemes, setUserThemes } from '../utils/theme'
import { BUILTIN_THEME_IDS } from '../themes'
import { CustomModelsEditor } from './custom-models-editor'
import { ThemeEditor } from './theme-editor'
import { ThemeGallery } from './theme-gallery'
import type { UserThemeRecord } from '../../../shared/ipc-contracts'
import {
  MIN_TIMEOUT_SECONDS as COUNCIL_MIN_TIMEOUT,
  MAX_TIMEOUT_SECONDS as COUNCIL_MAX_TIMEOUT,
  clampTimeoutSeconds as clampCouncilTimeout,
} from '../../../shared/council-config'

// Empty `match` from the input means "no pattern" and must not be persisted
// as `""` — the main-process validator rejects unknown/empty-string quirks
// and downstream matching treats a missing key as "match anything".
function normalizedRules(rules: PermissionRule[]): PermissionRule[] {
  return rules.map((rule) => {
    const tool = rule.tool.trim()
    const match = rule.match?.trim()
    return match ? { action: rule.action, tool, match } : { action: rule.action, tool }
  })
}

interface ScopeRulesState {
  rules: PermissionRule[]
  loaded: boolean
  loadError: string | null
  exists: boolean
}

const EMPTY_SCOPE_RULES: ScopeRulesState = { rules: [], loaded: false, loadError: null, exists: false }

export function SettingsPanel(): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const loadSettings = useAppStore((state) => state.loadSettings)
  const setSettingsDraft = useAppStore((state) => state.setSettingsDraft)
  const clearSettingsDraft = useAppStore((state) => state.clearSettingsDraft)
  const activeWorkspace = useAppStore((state) => state.activeWorkspace)

  // Snapshot the unsaved draft once, for seeding initial local state. This is
  // what makes edits survive leaving/returning to Settings without saving.
  const draft0 = useAppStore.getState().settingsDraft

  // The stored piEngine setting may be 'auto'; this is the engine that actually
  // resolved, which is what any sentence naming the running agent has to say.
  const runningEngineLabel = useAppStore((state) => agentEngineLabel(state.piEngine) ?? DEFAULT_AGENT_ENGINE_LABEL)
  const [theme, setTheme] = useState(draft0.theme ?? settings?.theme ?? DEFAULT_SETTINGS.theme)
  const [language, setLanguage] = useState<AppLanguage>(draft0.language ?? settings?.language ?? DEFAULT_LANGUAGE)
  const [themeActionError, setThemeActionError] = useState<string | null>(null)

  const [themeEditorState, setThemeEditorState] = useState<{
    baseTheme: ThemeFile
    baseId: string
    isUserTheme: boolean
  } | null>(null)
  const [installUrl, setInstallUrl] = useState('')
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [fontSize, setFontSize] = useState(draft0.fontSize ?? settings?.fontSize ?? DEFAULT_SETTINGS.fontSize)
  const [terminalFontSize, setTerminalFontSize] = useState(draft0.terminalFontSize ?? settings?.terminalFontSize ?? DEFAULT_SETTINGS.terminalFontSize)
  const [codeEditorFontSize, setCodeEditorFontSize] = useState(draft0.codeEditorFontSize ?? settings?.codeEditorFontSize ?? DEFAULT_SETTINGS.codeEditorFontSize)
  const [showThinking, setShowThinking] = useState(draft0.showThinking ?? settings?.showThinking ?? DEFAULT_SETTINGS.showThinking)
  const [autoScroll, setAutoScroll] = useState(draft0.autoScroll ?? settings?.autoScroll ?? DEFAULT_SETTINGS.autoScroll)
  const [desktopNotifications, setDesktopNotifications] = useState(draft0.desktopNotifications ?? settings?.desktopNotifications ?? DEFAULT_SETTINGS.desktopNotifications)
  const [resumeLastSession, setResumeLastSession] = useState(draft0.resumeLastSession ?? settings?.resumeLastSession ?? DEFAULT_SETTINGS.resumeLastSession)
  const [openToHomeOnLaunch, setOpenToHomeOnLaunch] = useState(draft0.openToHomeOnLaunch ?? settings?.openToHomeOnLaunch ?? DEFAULT_SETTINGS.openToHomeOnLaunch)
  const [runOnStartup, setRunOnStartup] = useState(draft0.runOnStartup ?? settings?.runOnStartup ?? DEFAULT_SETTINGS.runOnStartup)
  const [minimizeToTrayOnClose, setMinimizeToTrayOnClose] = useState(draft0.minimizeToTrayOnClose ?? settings?.minimizeToTrayOnClose ?? DEFAULT_SETTINGS.minimizeToTrayOnClose)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    draft0.permissionMode ?? settings?.permissionMode ?? DEFAULT_SETTINGS.permissionMode,
  )
  const [rulesScope, setRulesScope] = useState<PermissionRulesScope>('global')
  const [scopeRules, setScopeRules] = useState<Record<PermissionRulesScope, ScopeRulesState>>({
    global: EMPTY_SCOPE_RULES,
    workspace: EMPTY_SCOPE_RULES,
  })
  const [rulesActionError, setRulesActionError] = useState<string | null>(null)
  const [workspaceRulesStatus, setWorkspaceRulesStatus] = useState<PermissionRulesWorkspaceStatus | null>(null)

  const [showCouncilWarning, setShowCouncilWarning] = useState(false)
  const [detectedAgents, setDetectedAgents] = useState<Record<'pi' | 'claude' | 'codex', boolean>>({
    pi: false,
    claude: false,
    codex: false,
  })
  // Free-text draft for the timeout field so the user can clear it and type a
  // new value; it is clamped and persisted only on blur / Enter (not per keystroke).
  const [timeoutDraft, setTimeoutDraft] = useState('')

  // Detect available council agents on mount
  useEffect(() => {
    let cancelled = false
    void window.piDesktop.council.detect().then((result) => {
      if (cancelled) return
      const next: Record<'pi' | 'claude' | 'codex', boolean> = { pi: false, claude: false, codex: false }
      for (const agent of result.agents) {
        next[agent.id] = agent.found
      }
      setDetectedAgents(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Load permission rules for one scope. The store draft for that scope wins
  // over the saved file so unsaved edits survive view switches. The draft is
  // read at resolve time (inside the functional update), not before the
  // await, so an edit made during the round-trip isn't visually reverted by
  // a draft snapshot that predates it.
  const loadRulesScope = useCallback(async (scope: PermissionRulesScope): Promise<void> => {
    const saved = await window.piDesktop.permissionRules.get(scope)
    setScopeRules((prev) => {
      const draft = useAppStore.getState().permissionRulesDrafts[scope]
      return {
        ...prev,
        [scope]: saved.ok
          ? { rules: draft ?? saved.rules, loaded: true, loadError: null, exists: saved.exists }
          : // Corrupt file: only a pre-existing user draft keeps Save enabled —
            // see shouldPersistScope; an unrelated Save must not clobber it.
            { rules: draft ?? [], loaded: draft !== null, loadError: saved.error, exists: true },
      }
    })
  }, [])

  const loadWorkspaceRulesStatus = useCallback(async (): Promise<void> => {
    const status = await window.piDesktop.permissionRules.workspaceStatus()
    setWorkspaceRulesStatus(status)
  }, [])

  const handleSetWorkspaceTrust = useCallback(async (trusted: boolean): Promise<void> => {
    const status = await window.piDesktop.permissionRules.setWorkspaceTrust(trusted)
    setWorkspaceRulesStatus(status)
  }, [])

  useEffect(() => {
    void loadRulesScope('global')
    void loadRulesScope('workspace')
    void loadWorkspaceRulesStatus()
  }, [loadRulesScope, loadWorkspaceRulesStatus])

  // The workspace-scope rules are keyed by scope, not by workspace, so if the
  // active workspace changes while this panel stays mounted (e.g. switching
  // workspaces from the sidebar without leaving Settings), the previous
  // workspace's loaded/exists state would otherwise stick around and could
  // pass shouldPersistScope on an unrelated Save, writing it into the new
  // workspace's file. Reset and re-fetch whenever the path changes. Skipped
  // on the initial mount — the load-on-mount effect above already covers it.
  const activeWorkspacePathRef = useRef(activeWorkspace?.path ?? null)
  useEffect(() => {
    const path = activeWorkspace?.path ?? null
    if (activeWorkspacePathRef.current === path) return
    activeWorkspacePathRef.current = path
    setScopeRules((prev) => ({ ...prev, workspace: EMPTY_SCOPE_RULES }))
    void loadRulesScope('workspace')
    void loadWorkspaceRulesStatus()
  }, [activeWorkspace?.path, loadRulesScope, loadWorkspaceRulesStatus])

  // Re-read a scope's file when the user switches to its tab, so manual edits
  // to the file on disk show up — but not if there's an unsaved draft for it.
  const handleRulesScopeChange = (scope: PermissionRulesScope): void => {
    setRulesScope(scope)
    setRulesActionError(null)
    if (useAppStore.getState().permissionRulesDrafts[scope] === null) void loadRulesScope(scope)
  }

  // Keep the timeout draft in sync with the persisted value (e.g. after a save
  // clamps it, or when settings first load).
  const councilTimeout = settings?.council?.timeoutSeconds
  useEffect(() => {
    if (councilTimeout !== undefined) setTimeoutDraft(String(councilTimeout))
  }, [councilTimeout])

  // Merge a council patch into the current config and persist via the store mechanism
  const saveCouncil = async (patch: Partial<CouncilConfig>): Promise<void> => {
    if (!settings) return
    const nextCouncil: CouncilConfig = { ...settings.council, ...patch }
    await window.piDesktop.settings.save({ council: nextCouncil })
    await loadSettings()
  }

  // Persist a setting immediately. Toggles, selects, and theme picks write
  // through here — there is no staged Save button.
  const persistSetting = async (patch: Partial<AppSettings>): Promise<AppSettings | null> => {
    const result = await window.piDesktop.settings.save(patch)
    await loadSettings()
    return result
  }

  const persistSettingPatch = (patch: Partial<AppSettings>): void => {
    setSettingsDraft(patch)
    void persistSetting(patch)
  }

  const previewSettingPatch = (patch: Partial<AppSettings>): void => {
    setSettingsDraft(patch)
  }

  // Populate the form once, when settings first load. We deliberately do NOT
  // re-sync on every settings change: the UI font previews live and the
  // terminal/editor sizes are staged in store state, so re-syncing would
  // clobber in-progress slider drags. Reset sets local state directly.
  const didInitRef = useRef(false)
  useEffect(() => {
    if (!settings || didInitRef.current) return
    didInitRef.current = true
    const store = useAppStore.getState()
    const draft = store.settingsDraft
    setTheme(draft.theme ?? settings.theme)
    setFontSize(draft.fontSize ?? settings.fontSize)
    setTerminalFontSize(draft.terminalFontSize ?? settings.terminalFontSize)
    setCodeEditorFontSize(draft.codeEditorFontSize ?? settings.codeEditorFontSize)
    setShowThinking(draft.showThinking ?? settings.showThinking)
    setAutoScroll(draft.autoScroll ?? settings.autoScroll)
    setDesktopNotifications(draft.desktopNotifications ?? settings.desktopNotifications)
    setResumeLastSession(draft.resumeLastSession ?? settings.resumeLastSession)
    setOpenToHomeOnLaunch(draft.openToHomeOnLaunch ?? settings.openToHomeOnLaunch)
    setRunOnStartup(draft.runOnStartup ?? settings.runOnStartup)
    setMinimizeToTrayOnClose(draft.minimizeToTrayOnClose ?? settings.minimizeToTrayOnClose)
    setPermissionMode(draft.permissionMode ?? settings.permissionMode)
  }, [settings])

  const resolveEffectiveThemeId = (themeId: string): string => {
    if (themeId !== 'system') return themeId
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  const isBuiltinTheme = (themeId: string): boolean => (BUILTIN_THEME_IDS as string[]).includes(themeId)
  const isEditableUserTheme = theme !== 'system' && !isBuiltinTheme(theme)

  const openCreateThemeEditor = () => {
    const effectiveId = resolveEffectiveThemeId(theme)
    const registered = getRegisteredThemes()
    const baseTheme =
      registered.find((t) => t.id === effectiveId)?.file ??
      registered.find((t) => t.id === 'dark')!.file
    setThemeEditorState({ baseTheme, baseId: effectiveId, isUserTheme: false })
  }

  const openEditThemeEditor = () => {
    const baseTheme = getRegisteredThemes().find((t) => t.id === theme)?.file
    if (!baseTheme) {
      setThemeActionError(t(language, 'themeNotFoundToEdit'))
      return
    }
    setThemeEditorState({ baseTheme, baseId: theme, isUserTheme: true })
  }

  const handleThemeEditorSaved = async (id: string, warning?: string) => {
    setTheme(id)
    // A warning is a non-fatal post-save problem (rename cleanup failure).
    // It has to live in the panel's themeActionError, not the editor's own
    // saveError: the editor unmounts in this same commit, so only state
    // owned here survives long enough to render.
    setThemeActionError(warning ?? null)
    setThemeEditorState(null)
    persistSettingPatch({ theme: id })
    // Reconcile the registry against disk so a rename drops the old id from
    // the dropdown (the editor already registered + applied the new one).
    const { themes, warnings } = await window.piDesktop.themes.list()
    for (const w of warnings) console.warn(w)
    setUserThemes(themes)
  }

  const handleImportTheme = async () => {
    const result = await window.piDesktop.themes.import()
    if (result.ok) {
      registerThemes([result.theme])
      applyTheme(result.theme.id)
      setTheme(result.theme.id)
      persistSettingPatch({ theme: result.theme.id })
      setThemeActionError(null)
    } else if (!('canceled' in result)) {
      setThemeActionError(result.error)
    }
  }

  const handleExportTheme = async () => {
    const effectiveThemeId = resolveEffectiveThemeId(theme)
    const currentThemeFile = getRegisteredThemes().find((t) => t.id === effectiveThemeId)?.file
    if (!currentThemeFile) {
      setThemeActionError(t(language, 'themeNotFoundToExport'))
      return
    }
    const result = await window.piDesktop.themes.export(currentThemeFile)
    if (result.ok) {
      setThemeActionError(null)
    } else if (!('canceled' in result)) {
      setThemeActionError(result.error)
    }
  }

  const handleInstallFromUrl = async () => {
    if (!installUrl.trim()) return
    const result = await window.piDesktop.themes.installFromUrl(installUrl.trim())
    if (result.ok) {
      registerThemes([result.theme])
      applyTheme(result.theme.id)
      setTheme(result.theme.id)
      persistSettingPatch({ theme: result.theme.id })
      setThemeActionError(null)
      setInstallUrl('')
    } else if (!('canceled' in result)) {
      setThemeActionError(result.error)
    }
  }
  const handleGalleryInstalled = (installed: UserThemeRecord) => {
    registerThemes([installed])
    applyTheme(installed.id)
    setTheme(installed.id)
    persistSettingPatch({ theme: installed.id })
    setThemeActionError(null)
  }

  const handleDeleteTheme = async () => {
    const themeName = getRegisteredThemes().find((t) => t.id === theme)?.file.name ?? theme
    // Confirm before destructive action via the app's themed dialog, matching
    // the pattern used for session delete (context-menu.tsx) rather than the
    // native window.confirm. Deleting a theme file has no undo.
    const ok = await useAppStore.getState().requestConfirm({
      title: 'Delete theme',
      message: `Delete theme "${themeName}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    await window.piDesktop.themes.delete(theme)
    const { themes, warnings } = await window.piDesktop.themes.list()
    for (const warning of warnings) {
      console.warn(warning)
    }
    setUserThemes(themes)
    setTheme('dark')
    applyTheme('dark')
    persistSettingPatch({ theme: 'dark' })
    setThemeActionError(null)
  }

  const handleRulesChange = (rules: PermissionRule[]): void => {
    setScopeRules((prev) => ({
      ...prev,
      [rulesScope]: { ...prev[rulesScope], rules, loaded: true },
    }))
    setRulesActionError(null)
    useAppStore.getState().setPermissionRulesDraft(rulesScope, rules)
    void persistPermissionRules(rulesScope, rules)
  }

  const handleRulesImport = async (): Promise<void> => {
    const result = await window.piDesktop.permissionRules.importFromFile()
    if (result.ok) {
      handleRulesChange(result.rules)
    } else if (!result.canceled) {
      setRulesActionError(result.error ?? t(language, 'importFailed'))
    }
  }

  const handleRulesExport = async (): Promise<void> => {
    const result = await window.piDesktop.permissionRules.exportToFile(normalizedRules(scopeRules[rulesScope].rules))
    if (!result.ok && !result.canceled) {
      setRulesActionError(result.error ?? t(language, 'exportFailed'))
    }
  }

  // Only reachable from the workspace tab (the button is scope-gated in the
  // editor), so `rulesScope` is 'workspace' when this runs.
  const handleCopyFromGlobal = (): void => {
    handleRulesChange(scopeRules.global.rules.map((rule) => ({ ...rule })))
  }

  const handleRemoveWorkspaceRules = async (): Promise<void> => {
    const confirmed = await useAppStore.getState().requestConfirm({
      title: 'Remove workspace rules',
      message:
        'Delete this workspace\'s .pi-desktop/permission-rules.json? Global permission rules will apply again.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!confirmed) return
    const result = await window.piDesktop.permissionRules.removeWorkspace()
    if (!result.ok) {
      setRulesActionError(result.error)
      return
    }
    useAppStore.getState().setPermissionRulesDraft('workspace', null)
    setScopeRules((prev) => ({ ...prev, workspace: { ...EMPTY_SCOPE_RULES, loaded: true } }))
  }

  const persistPermissionRules = async (scope: PermissionRulesScope, rules: PermissionRule[]): Promise<void> => {
    const loaded = scopeRules[scope].loaded
    const exists = scopeRules[scope].exists
    if (!shouldPersistScope(rules, loaded, exists)) return
    const rulesError = validateRuleList(rules)
    if (rulesError) {
      setRulesScope(scope)
      setRulesActionError(rulesError)
      return
    }
    const rulesResult = await window.piDesktop.permissionRules.set(scope, normalizedRules(rules))
    if (!rulesResult.ok) {
      setRulesScope(scope)
      setRulesActionError(`${scope} permission rules were not saved: ${rulesResult.error}`)
      return
    }
    useAppStore.getState().setPermissionRulesDraft(scope, null)
    setScopeRules((prev) => ({
      ...prev,
      [scope]: { ...prev[scope], loadError: null, exists: true },
    }))
  }

  const handleReset = async () => {
    // Reset only the fields this panel exposes; the rest (council, default
    // model/provider/cwd, collapsed groups) are left as-is by the Partial merge.
    // Values come from the shared DEFAULT_SETTINGS so there's one source of truth.
    const defaults: Partial<AppSettings> = {
      piExecutablePath: DEFAULT_SETTINGS.piExecutablePath,
      piEngine: DEFAULT_SETTINGS.piEngine,
      theme: DEFAULT_SETTINGS.theme,
      language: DEFAULT_SETTINGS.language,
      fontSize: DEFAULT_SETTINGS.fontSize,
      terminalFontSize: DEFAULT_SETTINGS.terminalFontSize,
      codeEditorFontSize: DEFAULT_SETTINGS.codeEditorFontSize,
      showThinking: DEFAULT_SETTINGS.showThinking,
      autoScroll: DEFAULT_SETTINGS.autoScroll,
      desktopNotifications: DEFAULT_SETTINGS.desktopNotifications,
      resumeLastSession: DEFAULT_SETTINGS.resumeLastSession,
      openToHomeOnLaunch: DEFAULT_SETTINGS.openToHomeOnLaunch,
      runOnStartup: DEFAULT_SETTINGS.runOnStartup,
      minimizeToTrayOnClose: DEFAULT_SETTINGS.minimizeToTrayOnClose,
      permissionMode: DEFAULT_SETTINGS.permissionMode,
    }

    setTheme(defaults.theme!)
    setLanguage(defaults.language!)
    setFontSize(defaults.fontSize!)
    setTerminalFontSize(defaults.terminalFontSize!)
    setCodeEditorFontSize(defaults.codeEditorFontSize!)
    setShowThinking(defaults.showThinking!)
    setAutoScroll(defaults.autoScroll!)
    setDesktopNotifications(defaults.desktopNotifications!)

    setResumeLastSession(defaults.resumeLastSession!)
    setOpenToHomeOnLaunch(defaults.openToHomeOnLaunch!)
    setRunOnStartup(defaults.runOnStartup!)
    setMinimizeToTrayOnClose(defaults.minimizeToTrayOnClose!)
    setPermissionMode(defaults.permissionMode!)
    setScopeRules({ global: EMPTY_SCOPE_RULES, workspace: EMPTY_SCOPE_RULES })
    setRulesActionError(null)
    useAppStore.getState().setPermissionRulesDraft('global', null)
    useAppStore.getState().setPermissionRulesDraft('workspace', null)
    void loadRulesScope('global')
    void loadRulesScope('workspace')

    const result = await window.piDesktop.settings.save(defaults)
    applyTheme(result.theme)
    document.documentElement.style.fontSize = `${result.fontSize}px`
    await loadSettings()
    clearSettingsDraft()
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings size={20} className="text-muted" />
            <h1 className="text-lg font-semibold text-primary">{t(language, 'settings')}</h1>
          </div>
        </div>

        <SettingsSection title={t(language, 'appearance')}>
          <SettingsRow label={t(language, 'language')} description={t(language, 'languageDescription')}>
            <ThemedSelect
              value={language}
              onChange={(next) => {
                const lang = next as AppLanguage
                setLanguage(lang)
                persistSettingPatch({ language: lang })
              }}
              options={[
                { value: 'zh', label: t(language, 'languageZh') },
                { value: 'en', label: t(language, 'languageEn') },
              ]}
            />
          </SettingsRow>
          <SettingsRow label={t(language, 'theme')} description={t(language, 'themeHint')}>
            <ThemedSelect
              value={theme}
              onChange={(newTheme) => {
                setTheme(newTheme)
                applyTheme(newTheme)
                persistSettingPatch({ theme: newTheme })
              }}
              options={[
                { value: 'system', label: t(language, 'themeSystem') },
                ...getRegisteredThemes().map((registeredTheme) => ({
                  value: registeredTheme.id,
                  label: registeredTheme.file.name,
                })),
              ]}
            />
          </SettingsRow>


          <SettingsRow label={t(language, 'customTheme')} description={t(language, 'customThemeHint')}>
            <div className="flex gap-2">
              <button
                onClick={openCreateThemeEditor}
                className="rounded-md border border-border-strong bg-transparent px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent-fg hover:text-primary"
              >
                {t(language, 'createTheme')}
              </button>
              {isEditableUserTheme && (
                <button
                  onClick={openEditThemeEditor}
                  className="rounded-md border border-border-strong bg-transparent px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent-fg hover:text-primary"
                >
                  {t(language, 'editTheme')}
                </button>
              )}
            </div>
          </SettingsRow>

          <SettingsRow label={t(language, 'themeActions')} description={t(language, 'themeActionsHint')} stack>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button
                  onClick={handleImportTheme}
                  className="rounded-md border border-border-strong bg-transparent px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent-fg hover:text-primary"
                >
                  {t(language, 'import')}
                </button>
                <button
                  onClick={handleExportTheme}
                  className="rounded-md border border-border-strong bg-transparent px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent-fg hover:text-primary"
                >
                  {t(language, 'export')}
                </button>
                <button
                  onClick={() => setGalleryOpen(true)}
                  className="rounded-md border border-border-strong bg-transparent px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent-fg hover:text-primary"
                >
                  {t(language, 'browseGallery')}
                </button>
                {!isBuiltinTheme(theme) && (
                  <button
                    onClick={handleDeleteTheme}
                    className="rounded-md border border-border-strong bg-transparent px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent-fg hover:text-primary"
                  >
                    {t(language, 'delete')}
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={installUrl}
                  onChange={(e) => setInstallUrl(e.target.value)}
                  placeholder="https://example.com/theme.json"
                  className="flex-1 rounded-md border border-border-strong bg-transparent px-3 py-1.5 text-sm text-primary focus:border-accent-fg focus:outline-none"
                />
                <button
                  onClick={handleInstallFromUrl}
                  className="shrink-0 rounded-md border border-border-strong bg-transparent px-3 py-1.5 text-sm text-muted transition-colors hover:border-accent-fg hover:text-primary"
                >
                  {t(language, 'install')}
                </button>
              </div>
              {themeActionError && <p className="text-xs text-error">{themeActionError}</p>}
            </div>
          </SettingsRow>

          <SettingsRow label={t(language, 'uiFontSize')} description={t(language, 'uiFontSizeHint')}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={10}
                max={20}
                value={fontSize}
                onChange={(e) => {
                  const size = Number(e.target.value)
                  setFontSize(size)
                  document.documentElement.style.fontSize = `${size}px`
                  previewSettingPatch({ fontSize: size })
                }}
                onPointerUp={(e) => persistSettingPatch({ fontSize: Number((e.target as HTMLInputElement).value) })}
                onKeyUp={(e) => persistSettingPatch({ fontSize: Number((e.target as HTMLInputElement).value) })}
                className="flex-1 accent-accent"
              />
              <span className="w-8 text-right text-sm text-muted">{fontSize}</span>
            </div>
          </SettingsRow>

          <SettingsRow label={t(language, 'terminalFontSize')} description={t(language, 'terminalFontSizeHint')}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={10}
                max={20}
                value={terminalFontSize}
                onChange={(e) => {
                  const size = Number(e.target.value)
                  setTerminalFontSize(size)
                  previewSettingPatch({ terminalFontSize: size })
                }}
                onPointerUp={(e) => persistSettingPatch({ terminalFontSize: Number((e.target as HTMLInputElement).value) })}
                onKeyUp={(e) => persistSettingPatch({ terminalFontSize: Number((e.target as HTMLInputElement).value) })}
                className="flex-1 accent-accent"
              />
              <span className="w-8 text-right text-sm text-muted">{terminalFontSize}</span>
            </div>
          </SettingsRow>

          <SettingsRow label={t(language, 'codeEditorFontSize')} description={t(language, 'codeEditorFontSizeHint')}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={10}
                max={20}
                value={codeEditorFontSize}
                onChange={(e) => {
                  const size = Number(e.target.value)
                  setCodeEditorFontSize(size)
                  previewSettingPatch({ codeEditorFontSize: size })
                }}
                onPointerUp={(e) => persistSettingPatch({ codeEditorFontSize: Number((e.target as HTMLInputElement).value) })}
                onKeyUp={(e) => persistSettingPatch({ codeEditorFontSize: Number((e.target as HTMLInputElement).value) })}
                className="flex-1 accent-accent"
              />
              <span className="w-8 text-right text-sm text-muted">{codeEditorFontSize}</span>
            </div>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={t(language, 'behavior')}>
          <SettingsRow label={t(language, 'permissionMode')} description={t(language, 'permissionModeHint')}>
            <PermissionSelector
              value={permissionMode}
              onChange={(mode) => {
                setPermissionMode(mode)
                persistSettingPatch({ permissionMode: mode })
              }}
              compact
            />
          </SettingsRow>

          <SettingsRow label={t(language, 'permissionRules')} description={t(language, 'permissionRulesHint')} stack>
            <div className="mb-2 flex gap-1" role="tablist" aria-label={t(language, 'permissionRulesScope')}>
              {(['global', 'workspace'] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  role="tab"
                  aria-selected={rulesScope === scope}
                  onClick={() => handleRulesScopeChange(scope)}
                  className={clsx(
                    'rounded-md border bg-transparent px-2 py-1 text-xs transition-colors',
                    rulesScope === scope
                      ? 'border-accent-fg text-primary'
                      : 'border-border-strong text-dim hover:border-border-strong-hover hover:text-primary'
                  )}
                >
                  {scope === 'global' ? t(language, 'global') : t(language, 'thisWorkspace')}
                </button>
              ))}
            </div>
            <PermissionRulesEditor
              rules={scopeRules[rulesScope].rules}
              onChange={handleRulesChange}
              onImport={() => void handleRulesImport()}
              onExport={() => void handleRulesExport()}
              scope={rulesScope}
              workspaceExists={scopeRules.workspace.exists}
              onCopyFromGlobal={handleCopyFromGlobal}
              onRemoveWorkspace={() => void handleRemoveWorkspaceRules()}
              workspaceOverride={scopeRules.workspace.exists}
              workspaceActive={!!activeWorkspace}
              workspaceTrusted={workspaceRulesStatus?.trusted ?? false}
              workspaceHasAllowRules={workspaceRulesStatus?.hasAllowRules ?? false}
              onSetWorkspaceTrust={(trusted) => void handleSetWorkspaceTrust(trusted)}
              loadError={scopeRules[rulesScope].loadError}
              actionError={rulesActionError}
            />
          </SettingsRow>

          <SettingsRow label={t(language, 'showThinking')} description={t(language, 'showThinkingHint')}>
            <Toggle checked={showThinking} onChange={(v) => { setShowThinking(v); persistSettingPatch({ showThinking: v }) }} />
          </SettingsRow>

          <SettingsRow label={t(language, 'autoScroll')} description={t(language, 'autoScrollHint')}>
            <Toggle checked={autoScroll} onChange={(v) => { setAutoScroll(v); persistSettingPatch({ autoScroll: v }) }} />
          </SettingsRow>

          <SettingsRow
            label={t(language, 'desktopNotifications')}
            description={t(language, 'desktopNotificationsHint')}
          >
            <Toggle checked={desktopNotifications} onChange={(v) => { setDesktopNotifications(v); persistSettingPatch({ desktopNotifications: v }) }} />
          </SettingsRow>

          <SettingsRow
            label={t(language, 'openToHomeOnLaunch')}
            description={t(language, 'openToHomeOnLaunchHint')}
          >
            <Toggle checked={openToHomeOnLaunch} onChange={(v) => { setOpenToHomeOnLaunch(v); persistSettingPatch({ openToHomeOnLaunch: v }) }} />
          </SettingsRow>

          <SettingsRow
            label={t(language, 'resumeLastSession')}
            description={t(language, 'resumeLastSessionHint')}
          >
            <Toggle checked={resumeLastSession} onChange={(v) => { setResumeLastSession(v); persistSettingPatch({ resumeLastSession: v }) }} />
          </SettingsRow>

          <SettingsRow
            label={t(language, 'runOnStartup')}
            description={t(language, 'runOnStartupHint')}
          >
            <Toggle checked={runOnStartup} onChange={(v) => { setRunOnStartup(v); persistSettingPatch({ runOnStartup: v }) }} />
          </SettingsRow>

          <SettingsRow
            label={t(language, 'minimizeToTrayOnClose')}
            description={t(language, 'minimizeToTrayOnCloseHint')}
          >
            <Toggle checked={minimizeToTrayOnClose} onChange={(v) => { setMinimizeToTrayOnClose(v); persistSettingPatch({ minimizeToTrayOnClose: v }) }} />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection title={t(language, 'councilPlanning')}>
          <SettingsRow
            label={t(language, 'enableCouncil')}
            description={t(language, 'enableCouncilHint')}
          >
            <Toggle
              checked={settings?.council.enabled ?? false}
              onChange={(value) => {
                if (value) {
                  setShowCouncilWarning(true)
                } else {
                  void saveCouncil({ enabled: false })
                }
              }}
            />
          </SettingsRow>

          {settings?.council.enabled && (
            <>
              <SettingsRow label={t(language, 'councilMembers')} description={t(language, 'councilMembersHint')}>
                <div className="flex flex-col gap-2">
                  {(['pi', 'claude', 'codex'] as const).map((id) => {
                    const detected = detectedAgents[id]
                    const label = id === 'pi' ? 'Pi' : id === 'claude' ? 'Claude' : 'Codex'
                    return (
                      <label
                        key={id}
                        className={`flex items-center gap-2 text-sm ${
                          detected ? 'text-primary' : 'text-dim'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={!detected}
                          checked={settings.council.members[id]}
                          onChange={(e) =>
                            void saveCouncil({
                              members: { ...settings.council.members, [id]: e.target.checked },
                            })
                          }
                          className="accent-accent disabled:opacity-50"
                        />
                        <span>
                          {label}
                          {!detected && <span className="text-faint"> {t(language, 'notDetected')}</span>}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </SettingsRow>

              <SettingsRow
                label={t(language, 'consensusMode')}
                description={t(language, 'consensusModeHint')}
              >
                <ThemedSelect
                  value={settings.council.consensusMode}
                  onChange={(next) =>
                    void saveCouncil({
                      consensusMode: next as CouncilConfig['consensusMode'],
                    })
                  }
                  options={[
                    { value: 'arbiter', label: t(language, 'consensusArbiter') },
                    { value: 'debate', label: t(language, 'consensusDebate') },
                  ]}
                />
              </SettingsRow>

              <SettingsRow
                label="Per-member timeout (seconds)"
                description={`How long to wait for each agent (${COUNCIL_MIN_TIMEOUT}-${COUNCIL_MAX_TIMEOUT})`}
              >
                <input
                  type="number"
                  min={COUNCIL_MIN_TIMEOUT}
                  max={COUNCIL_MAX_TIMEOUT}
                  value={timeoutDraft}
                  onChange={(e) => setTimeoutDraft(e.target.value)}
                  onBlur={() => {
                    const clamped = clampCouncilTimeout(Number(timeoutDraft))
                    setTimeoutDraft(String(clamped))
                    if (clamped !== settings.council.timeoutSeconds) {
                      void saveCouncil({ timeoutSeconds: clamped })
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  className="w-full rounded-md border border-border-strong bg-transparent px-3 py-1.5 text-sm text-primary focus:border-accent-fg focus:outline-none"
                />
              </SettingsRow>
            </>
          )}
        </SettingsSection>

        <SettingsSection title={t(language, 'customModels')}>
          <CustomModelsEditor />
        </SettingsSection>

        <div className="mt-8 flex gap-3">
          <button
            onClick={handleReset}
            className="flex items-center gap-2 rounded-md border border-border-strong bg-transparent px-4 py-2 text-sm text-muted transition-colors hover:border-accent-fg hover:text-primary"
          >
            <RotateCcw size={14} />
            {t(language, 'resetDefaults')}
          </button>
        </div>
      </div>

      {galleryOpen && (
        <ThemeGallery
          onClose={() => setGalleryOpen(false)}
          onInstalled={handleGalleryInstalled}
        />
      )}

      {themeEditorState && (
        <ThemeEditor
          baseTheme={themeEditorState.baseTheme}
          baseId={themeEditorState.baseId}
          isUserTheme={themeEditorState.isUserTheme}
          onClose={() => setThemeEditorState(null)}
          onSaved={handleThemeEditorSaved}
        />
      )}

      {showCouncilWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-lg border border-border-strong bg-surface p-6 shadow-xl">
            <h3 className="mb-3 text-base font-semibold text-primary">
              {t(language, 'enableCouncilTitle')}
            </h3>
            <p className="mb-6 text-sm text-muted">
              {t(language, 'enableCouncilBody', { engine: runningEngineLabel })}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCouncilWarning(false)}
                className="rounded-md border border-border-strong bg-transparent px-4 py-2 text-sm text-muted transition-colors hover:border-accent-fg hover:text-primary"
              >
                {t(language, 'cancel')}
              </button>
              <button
                onClick={() => {
                  setShowCouncilWarning(false)
                  void saveCouncil({ enabled: true })
                }}
                className="rounded-md border border-accent-fg bg-transparent px-4 py-2 text-sm text-primary transition-colors hover:border-focus"
              >
                {t(language, 'enable')}
              </button>

            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Components ──────────────────────────────────────────────────────────────

function SettingsSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-8">
      <h2 className="mb-4 text-sm font-medium text-secondary">{title}</h2>
      <div className="space-y-4 rounded-lg border border-border bg-transparent p-4">
        {children}
      </div>
    </div>
  )
}

function SettingsRow({
  label,
  description,
  children,
  stack = false,
}: {
  label: string
  description: string
  children: React.ReactNode
  // Controls that are wider than the fixed control column (e.g. a URL input
  // beside a button) render below the label at full width instead of being
  // crammed into the right-hand w-64 column.
  stack?: boolean
}): React.JSX.Element {
  if (stack) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <div className="text-sm text-primary">{label}</div>
          <div className="text-xs text-dim">{description}</div>
        </div>
        <div>{children}</div>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm text-primary">{label}</div>
        <div className="text-xs text-dim">{description}</div>
      </div>
      <div className="w-64">{children}</div>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full border bg-transparent transition-colors ${
        checked ? 'border-accent-fg' : 'border-border-strong'
      }`}
    >
      <span
        className={`inline-block h-3 w-3 rounded-full transition-all ${
          checked
            ? 'translate-x-4 bg-white shadow-[0_0_8px_rgba(255,255,255,0.85)]'
            : 'translate-x-1 border border-border-strong-hover bg-transparent'
        }`}
      />
    </button>
  )
}
