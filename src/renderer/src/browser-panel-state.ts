import type { WorkspaceBrowserPanel } from './store'

const STORAGE_KEY = 'vespi.browser-panels.v1'

export interface BrowserPanelStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

function isWorkspaceBrowserPanel(value: unknown): value is WorkspaceBrowserPanel {
  if (!value || typeof value !== 'object') return false
  const panel = value as Partial<WorkspaceBrowserPanel>
  if (typeof panel.open !== 'boolean' || typeof panel.nonce !== 'number' || !Number.isFinite(panel.nonce)) {
    return false
  }
  if (panel.url === null) return true
  if (typeof panel.url !== 'string') return false
  try {
    const url = new URL(panel.url)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function readBrowserPanelState(storage?: BrowserPanelStorage): Record<string, WorkspaceBrowserPanel> {
  try {
    const source = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)
    const raw = source?.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, WorkspaceBrowserPanel] => isWorkspaceBrowserPanel(entry[1]))
    )
  } catch {
    return {}
  }
}

export function writeBrowserPanelState(
  panels: Record<string, WorkspaceBrowserPanel>,
  storage?: BrowserPanelStorage
): void {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)
    target?.setItem(STORAGE_KEY, JSON.stringify(panels))
  } catch {
    // Storage can be disabled or full; browser usage should still work in memory.
  }
}
