import { FolderTree, Globe, ShieldCheck, SquareTerminal } from 'lucide-react'
import { clsx } from 'clsx'
import { useAppStore } from '../store'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'

type SideTab = 'review' | 'terminal' | 'browser' | 'files'

const TABS: Array<{
  id: SideTab
  icon: React.ReactNode
  title: 'sideTabReview' | 'sideTabTerminal' | 'sideTabBrowser' | 'sideTabFiles'
  hint: 'sideTabReviewHint' | 'sideTabTerminalHint' | 'sideTabBrowserHint' | 'sideTabFilesHint'
}> = [
  { id: 'review', icon: <ShieldCheck size={15} />, title: 'sideTabReview', hint: 'sideTabReviewHint' },
  { id: 'terminal', icon: <SquareTerminal size={15} />, title: 'sideTabTerminal', hint: 'sideTabTerminalHint' },
  { id: 'browser', icon: <Globe size={15} />, title: 'sideTabBrowser', hint: 'sideTabBrowserHint' },
  { id: 'files', icon: <FolderTree size={15} />, title: 'sideTabFiles', hint: 'sideTabFilesHint' },
]

export function SideTabPicker(): React.JSX.Element {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  const setChatSidePanel = useAppStore((state) => state.setChatSidePanel)

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="px-5 pb-3 pt-8 text-center">
        <h2 className="text-sm font-medium text-primary">{t(language, 'openSideTabs')}</h2>
        <p className="mt-1 text-[11px] text-dim">{t(language, 'openSideTabsHint')}</p>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-6">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => void setChatSidePanel(tab.id)}
            className={clsx(
              'flex items-center gap-3 rounded-lg border border-border bg-transparent px-3 py-3 text-left transition-colors',
              'hover:border-border-strong hover:bg-highlight/40'
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-card text-muted">
              {tab.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-sm text-primary">{t(language, tab.title)}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-dim">{t(language, tab.hint)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
