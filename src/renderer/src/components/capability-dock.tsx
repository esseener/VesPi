import { useAppStore } from '../store'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'
import { clsx } from 'clsx'
import { useMemo } from 'react'

type DockItem = {
  n: string
  titleKey: Parameters<typeof t>[1]
  descKey: Parameters<typeof t>[1]
}

const DOCK: DockItem[] = [
  { n: '01', titleKey: 'dockCommands', descKey: 'dockCommandsDesc' },
  { n: '02', titleKey: 'dockTools', descKey: 'dockToolsDesc' },
  { n: '03', titleKey: 'dockSubagents', descKey: 'dockSubagentsDesc' },
  { n: '04', titleKey: 'dockSteer', descKey: 'dockSteerDesc' },
  { n: '05', titleKey: 'dockModel', descKey: 'dockModelDesc' },
  { n: '06', titleKey: 'dockApprovals', descKey: 'dockApprovalsDesc' },
  { n: '07', titleKey: 'dockExport', descKey: 'dockExportDesc' },
  { n: '08', titleKey: 'dockVoice', descKey: 'dockVoiceDesc' },
  { n: '09', titleKey: 'dockBranch', descKey: 'dockBranchDesc' },
  { n: '10', titleKey: 'dockAdvanced', descKey: 'dockAdvancedDesc' },
  { n: '11', titleKey: 'dockLogin', descKey: 'dockLoginDesc' },
  { n: '12', titleKey: 'dockLastReply', descKey: 'dockLastReplyDesc' },
  { n: '13', titleKey: 'dockHistory', descKey: 'dockHistoryDesc' },
  { n: '14', titleKey: 'dockAbort', descKey: 'dockAbortDesc' },
]

/** OMP 能力坞 — 右侧仪表架，与命令面板同一数据源（后续接 RPC）。 */
export function CapabilityDock(): React.JSX.Element {
  const language = useAppStore(
    (state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE
  )
  const subagentProgress = useAppStore((state) => state.subagentProgress)
  const running = useMemo(
    () =>
      subagentProgress.filter((p) => (p.status ?? 'running').toLowerCase() === 'running')
        .length,
    [subagentProgress]
  )

  return (
    <aside
      data-capability-dock
      className="flex w-[220px] shrink-0 flex-col overflow-hidden border-l border-border bg-surface"
    >
      <div className="px-3 pb-2 pt-3 text-[11px] font-semibold tracking-[0.08em] text-dim">
        {t(language, 'dockTitle')}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-3">
        {DOCK.map((item) => (
          <div
            key={item.n}
            className={clsx(
              'rounded-lg border border-border bg-surface-2 px-2.5 py-2',
              item.n === '03' && running > 0 && 'border-accent/40'
            )}
          >
            <div className="flex items-center gap-2">
              <span className="font-jetbrains text-[10px] text-dim">{item.n}</span>
              <span className="text-[12.5px] text-primary">{t(language, item.titleKey)}</span>
              {item.n === '03' && running > 0 && (
                <span className="ml-auto rounded bg-warning-bg px-1 text-[10px] text-warning">
                  {running}
                </span>
              )}
            </div>
            <div className="mt-0.5 pl-6 text-[11px] leading-snug text-dim">
              {t(language, item.descKey)}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
