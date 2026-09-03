import { useEffect, useState, useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import {
  Copy,
  Scissors,
  ClipboardPaste,
  TextSelect,
  ExternalLink,
  Search,
  Archive,
  ArchiveRestore,
  Trash2,
  MessageSquare,
  StickyNote,
  Pencil,
  FolderOpen,
  Workflow as WorkflowIcon,
} from 'lucide-react'
import type { SessionListItem } from '../../../shared/ipc-contracts'
import { useAppStore } from '../store'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'

function menuLang() {
  const state = useAppStore.getState()
  return state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE
}


interface ContextMenuItem {
  id: string
  label: string
  icon?: React.ReactNode
  shortcut?: string
  disabled?: boolean
  divider?: boolean
  action: () => void
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  items: ContextMenuItem[]
}

const MENU_WIDTH = 220
const MENU_ITEM_HEIGHT = 32
const PADDING = 8

export function useContextMenu(): {
  show: (e: React.MouseEvent, items: ContextMenuItem[]) => void
  hide: () => void
  ContextMenuComponent: React.JSX.Element | null
} {
  const [state, setState] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    items: [],
  })

  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const show = useCallback((e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    const visibleItems = items.filter((item) => !item.divider || items.length > 1)
    if (visibleItems.length === 0) return

    // Remember the element to restore focus to when the menu closes.
    triggerRef.current = document.activeElement as HTMLElement | null

    // Calculate position, keeping menu within viewport
    let x = e.clientX
    let y = e.clientY
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    if (x + MENU_WIDTH > viewportWidth - PADDING) {
      x = viewportWidth - MENU_WIDTH - PADDING
    }

    const estimatedHeight = visibleItems.filter((i) => !i.divider).length * MENU_ITEM_HEIGHT + 20
    if (y + estimatedHeight > viewportHeight - PADDING) {
      y = viewportHeight - estimatedHeight - PADDING
    }

    setState({ visible: true, x, y, items: visibleItems })
  }, [])

  const hide = useCallback(() => {
    setState((prev) => ({ ...prev, visible: false }))
  }, [])

  // Close on click outside
  useEffect(() => {
    if (!state.visible) return

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hide()
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      // Escape closes; Tab dismisses so focus isn't trapped behind the menu.
      if (e.key === 'Escape' || e.key === 'Tab') hide()
    }

    // Delay to avoid immediate close from the same right-click
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick)
      document.addEventListener('keydown', handleEscape)
    }, 10)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [state.visible, hide])

  // Close on window scroll, but ignore scrolls originating inside the menu.
  useEffect(() => {
    if (!state.visible) return
    const handleScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return
      hide()
    }
    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [state.visible, hide])

  // Move focus into the menu when it opens; restore it to the trigger on close.
  useEffect(() => {
    if (state.visible) {
      menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    } else if (triggerRef.current) {
      triggerRef.current.focus()
      triggerRef.current = null
    }
  }, [state.visible])

  const component = state.visible ? (
    <div
      ref={menuRef}
      role="menu"
      aria-orientation="vertical"
      className="fixed z-[9999] min-w-[180px] rounded-lg border border-border-strong bg-surface py-1 shadow-xl shadow-black/40 animate-fade-in"
      style={{ left: state.x, top: state.y }}
    >
      {state.items.map((item) => {
        if (item.divider) {
          return <div key={item.id} className="my-1 border-t border-border" />
        }

        return (
          <button
            key={item.id}
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation()
              if (!item.disabled) {
                item.action()
                hide()
              }
            }}
            disabled={item.disabled}
            className={clsx(
              'flex w-full items-center gap-2.5 px-3 py-1.5 text-sm transition-colors',
              item.disabled
                ? 'text-faint cursor-not-allowed'
                : 'text-secondary hover:bg-surface-hover hover:text-primary'
            )}
          >
            {item.icon && (
              <span className="w-4 h-4 flex items-center justify-center text-dim">
                {item.icon}
              </span>
            )}
            <span className="flex-1 text-left">{item.label}</span>
            {item.shortcut && (
              <span className="text-xs text-faint ml-4">{item.shortcut}</span>
            )}
          </button>
        )
      })}
    </div>
  ) : null

  return { show, hide, ContextMenuComponent: component }
}

// ─── Built-in Context Menu Items ─────────────────────────────────────────────

function getSelectedText(): string {
  const selection = window.getSelection()
  return selection?.toString() ?? ''
}

function isTextField(el: HTMLElement | null | undefined): el is HTMLInputElement | HTMLTextAreaElement {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
}

function fieldSelection(field: HTMLInputElement | HTMLTextAreaElement): { start: number; end: number; text: string } {
  const start = field.selectionStart ?? 0
  const end = field.selectionEnd ?? 0
  return { start, end, text: field.value.slice(start, end) }
}

function replaceFieldRange(field: HTMLInputElement | HTMLTextAreaElement, start: number, end: number, insert: string): void {
  const before = field.value.slice(0, start)
  const after = field.value.slice(end)
  field.value = before + insert + after
  const caret = start + insert.length
  field.selectionStart = field.selectionEnd = caret
  field.dispatchEvent(new Event('input', { bubbles: true }))
  field.focus()
}

export function buildDefaultContextMenu(field?: HTMLElement | null): ContextMenuItem[] {
  const active = isTextField(field) ? field : isTextField(document.activeElement as HTMLElement | null) ? document.activeElement as HTMLInputElement | HTMLTextAreaElement : null

  if (active) {
    const { start, end, text } = fieldSelection(active)
    const hasSelection = text.length > 0
    const hasValue = active.value.length > 0
    return [
      {
        id: 'cut',
        label: '剪切',
        icon: <Scissors size={14} />,
        shortcut: 'Ctrl+X',
        disabled: !hasSelection || active.readOnly || active.disabled,
        action: () => {
          if (!hasSelection || active.readOnly || active.disabled) return
          void navigator.clipboard.writeText(text)
          replaceFieldRange(active, start, end, '')
        },
      },
      {
        id: 'copy',
        label: '复制',
        icon: <Copy size={14} />,
        shortcut: 'Ctrl+C',
        disabled: !hasSelection,
        action: () => {
          if (hasSelection) void navigator.clipboard.writeText(text)
        },
      },
      {
        id: 'paste',
        label: '粘贴',
        icon: <ClipboardPaste size={14} />,
        shortcut: 'Ctrl+V',
        disabled: active.readOnly || active.disabled,
        action: async () => {
          try {
            const pasted = await navigator.clipboard.readText()
            const range = fieldSelection(active)
            replaceFieldRange(active, range.start, range.end, pasted)
          } catch {
            // Clipboard API may be blocked
          }
        },
      },
      {
        id: 'delete',
        label: '删除',
        icon: <Trash2 size={14} />,
        shortcut: 'Del',
        disabled: !hasSelection || active.readOnly || active.disabled,
        action: () => {
          if (!hasSelection || active.readOnly || active.disabled) return
          replaceFieldRange(active, start, end, '')
        },
      },
      {
        id: 'divider-1',
        label: '',
        divider: true,
        action: () => {},
      },
      {
        id: 'select-all',
        label: '全选',
        icon: <TextSelect size={14} />,
        shortcut: 'Ctrl+A',
        disabled: !hasValue,
        action: () => {
          active.focus()
          active.select()
        },
      },
    ]
  }

  const selectedText = getSelectedText()
  if (selectedText.length === 0) return []
  return [
    {
      id: 'copy',
      label: t(menuLang(), 'copySelection'),
      icon: <Copy size={14} />,
      shortcut: 'Ctrl+C',
      action: () => {
        void navigator.clipboard.writeText(selectedText)
      },
    },
  ]
}

export function buildWorkspaceContextMenu(workspacePath: string): ContextMenuItem[] {
  return [
    {
      id: 'open-folder',
      label: t(menuLang(), 'openInExplorer'),
      icon: <FolderOpen size={14} />,
      action: () => {
        void window.piDesktop.system.revealPath(workspacePath)
      },
    },
  ]
}


export function buildCodeBlockContextMenu(code: string): ContextMenuItem[] {
  return [
    {
      id: 'copy-code',
      label: t(menuLang(), 'copyCodeBlock'),
      icon: <Copy size={14} />,
      shortcut: 'Ctrl+Shift+C',
      action: () => navigator.clipboard.writeText(code),
    },
    {
      id: 'search-code',
      label: t(menuLang(), 'searchSelection'),
      icon: <Search size={14} />,
      disabled: !getSelectedText(),
      action: () => {
        const text = getSelectedText()
        if (text) {
          window.piDesktop.system.openExternal(
            `https://www.google.com/search?q=${encodeURIComponent(text)}`
          )
        }
      },
    },
    ...buildDefaultContextMenu(),
  ]
}

export function buildMessageContextMenu(
  messageContent: string,
  onAddToNotes: (text: string) => void
): ContextMenuItem[] {
  const selectedText = getSelectedText()
  const hasSelection = selectedText.length > 0

  return [
    {
      id: 'copy-message',
      label: t(menuLang(), 'copyMessage'),
      icon: <Copy size={14} />,
      action: () => navigator.clipboard.writeText(messageContent),
    },
    {
      id: 'copy-selection',
      label: t(menuLang(), 'copySelection'),
      icon: <Copy size={14} />,
      disabled: !hasSelection,
      action: () => {
        if (hasSelection) navigator.clipboard.writeText(selectedText)
      },
    },
    {
      id: 'add-to-notes',
      label: hasSelection ? t(menuLang(), 'addSelectionToNotes') : t(menuLang(), 'addMessageToNotes'),
      icon: <StickyNote size={14} />,
      action: () => onAddToNotes(hasSelection ? selectedText : messageContent),
    },
    {
      id: 'divider-1',
      label: '',
      divider: true,
      action: () => {},
    },
    ...buildDefaultContextMenu(),
  ]
}

/**
 * Right-click menu for session entries (sidebar Recent Sessions list,
 * Sessions panel rows). Centralizes the Open / Archive / Delete actions
 * so both surfaces show the same behavior.
 */
export interface SessionContextMenuActions {
  onOpen: (session: SessionListItem) => void
  onArchive: (sessionId: string) => void
  onUnarchive: (sessionId: string) => void
  onDelete: (session: SessionListItem) => void
  // Optional: when provided, a "Rename…" item is shown (above Delete). Callers
  // pass this only for the active session, since Pi's rename targets it.
  onRename?: (session: SessionListItem) => void
  // Optional: when provided, a "Workflow Runs" item is shown (below Open). It
  // must open scoped to Pi's header UUID — the identifier runs carry — never
  // the session filename stem.
  onRuns?: (session: SessionListItem) => void
}

export function buildSessionContextMenu(
  session: SessionListItem,
  isArchived: boolean,
  actions: SessionContextMenuActions
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    {
      id: 'session-open',
      label: t(menuLang(), 'openSession'),
      icon: <MessageSquare size={14} />,
      action: () => actions.onOpen(session),
    },
    ...(actions.onRuns
      ? [{
          id: 'session-runs',
          label: t(menuLang(), 'workflowRuns'),
          icon: <WorkflowIcon size={14} />,
          action: () => actions.onRuns!(session),
        }]
      : []),
    {
      id: 'divider-session-1',
      label: '',
      divider: true,
      action: () => {},
    },
    isArchived
      ? {
          id: 'session-unarchive',
          label: t(menuLang(), 'unarchive'),
          icon: <ArchiveRestore size={14} />,
          action: () => actions.onUnarchive(session.sessionId),
        }
      : {
          id: 'session-archive',
          label: t(menuLang(), 'archive'),
          icon: <Archive size={14} />,
          action: () => actions.onArchive(session.sessionId),
        },
  ]

  if (actions.onRename) {
    items.push({
      id: 'session-rename',
      label: t(menuLang(), 'renameEllipsis'),
      icon: <Pencil size={14} />,
      action: () => actions.onRename!(session),
    })
  }

  items.push({
    id: 'session-delete',
    label: t(menuLang(), 'deleteEllipsis'),
    icon: <Trash2 size={14} />,
    action: () => {
      // Confirm is inline next to the session row (sidebar / session panel).
      // Do not open the global bottom/center AppConfirmDialog here.
      actions.onDelete(session)
    },
  })

  return items
}

export function buildLinkContextMenu(url: string): ContextMenuItem[] {
  return [
    {
      id: 'open-link',
      label: t(menuLang(), 'openLink'),
      icon: <ExternalLink size={14} />,
      action: () => window.piDesktop.system.openExternal(url),
    },
    {
      id: 'copy-link',
      label: t(menuLang(), 'copyLink'),
      icon: <Copy size={14} />,
      action: () => navigator.clipboard.writeText(url),
    },
    {
      id: 'divider-1',
      label: '',
      divider: true,
      action: () => {},
    },
    ...buildDefaultContextMenu(),
  ]
}
