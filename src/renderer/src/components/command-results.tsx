import { clsx } from 'clsx'
import { BUILTIN_SOURCE, type CommandGroup, type PiCommand } from '../../../shared/pi-command'
import {
  commandDisplayDescription,
  commandDisplayLabel,
  commandSourceLabel,
} from '../../../shared/command-display'
import { DEFAULT_LANGUAGE, t, type AppLanguage } from '../../../shared/i18n'
import { useAppStore } from '../store'

const SOURCE_BADGE: Record<string, string> = {
  skill: 'bg-special-bg text-special',
  prompt: 'bg-accent-bg text-accent-fg',
  [BUILTIN_SOURCE]: 'bg-warning-bg text-warning',
  extension: 'bg-success-bg text-success',
}

function groupHeading(language: AppLanguage, source: string): string {
  switch (source) {
    case 'skill':
      return t(language, 'cmdGroupSkills')
    case 'prompt':
      return t(language, 'cmdGroupPrompts')
    case 'builtin':
      return t(language, 'cmdGroupCommands')
    case 'extension':
      return t(language, 'cmdGroupExtensions')
    default:
      return t(language, 'cmdGroupOther')
  }
}

interface CommandResultsProps {
  grouped: CommandGroup[]
  flat: PiCommand[]
  activeIndex: number
  onSelect: (cmd: PiCommand) => void
  onHover: (index: number) => void
}

export function CommandResults({
  grouped,
  flat,
  activeIndex,
  onSelect,
  onHover,
}: CommandResultsProps): React.JSX.Element {
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  return (
    <>
      {grouped.map((group) => (
        <div key={group.source}>
          <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-faint">
            {groupHeading(language, group.source)}
          </div>

          {group.items.map((cmd) => {
            const index = flat.indexOf(cmd)
            return (
              <button
                key={`${cmd.source}:${cmd.name}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelect(cmd)}
                onMouseEnter={() => onHover(index)}
                className={clsx(
                  'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
                  index === activeIndex ? 'bg-card' : 'hover:bg-surface-hover/50'
                )}
              >
                <span
                  className={clsx(
                    'shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase',
                    SOURCE_BADGE[cmd.source] ?? 'bg-card text-muted'
                  )}
                >
                  {commandSourceLabel(cmd.source, language)}
                </span>
                <span className="truncate text-sm text-primary">
                  {commandDisplayLabel(cmd.name, language)}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-dim">
                  {cmd.source === BUILTIN_SOURCE ? `/${cmd.name}` : cmd.name}
                </span>
                <span className="line-clamp-1 max-w-[40%] text-xs text-dim">
                  {commandDisplayDescription(cmd.name, cmd.description, language)}
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </>
  )
}
