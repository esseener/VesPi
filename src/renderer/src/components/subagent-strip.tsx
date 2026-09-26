import { ChevronDown, ChevronRight, Layers } from 'lucide-react'
import { useState } from 'react'
import { DEFAULT_LANGUAGE, t, type MessageKey } from '../../../shared/i18n'
import { runningSubagentCount, type SubagentRun, type SubagentStatusKind } from '../../../shared/subagents'
import { useAppStore } from '../store'

const STATUS_KEY: Record<SubagentStatusKind, MessageKey> = {
  running: 'subagentsStatusRunning',
  finished: 'subagentsStatusDone',
  failed: 'subagentsStatusFailed',
}

const STATUS_CLASS: Record<SubagentStatusKind, string> = {
  running: 'text-accent-fg',
  finished: 'text-muted',
  failed: 'text-error',
}

/**
 * What the kernel's subagents are doing, mirrored from `subagent_lifecycle` /
 * `subagent_progress`.
 *
 * A `task` tool call otherwise renders as one card that sits still for minutes:
 * the helper agents it spawns run inside the kernel, so without subscribing
 * (see shared/subagents.ts) the user cannot tell whether three are working and
 * one has failed, or nothing is happening at all.
 *
 * Read-only on purpose — subagents are the model's own workers, and the kernel
 * exposes no verb to steer or cancel one from here.
 */
export function SubagentStrip(): React.JSX.Element | null {
  const language = useAppStore((s) => s.settingsDraft.language ?? s.settings?.language ?? DEFAULT_LANGUAGE)
  const subagents = useAppStore((s) => s.subagents)
  const [expanded, setExpanded] = useState(false)

  if (subagents.length === 0) return null

  const running = runningSubagentCount(subagents)

  return (
    <div className="pointer-events-auto mx-auto mb-2 w-full max-w-5xl px-4">
      <div className="border border-border bg-surface/60 px-3 py-1.5 text-xs">
        <div className="flex items-center gap-2.5">
          <Layers size={13} className="shrink-0 text-accent-fg" aria-hidden="true" />
          <span className="shrink-0 text-muted">{t(language, 'subagentsTitle')}</span>
          <span className="shrink-0 text-dim">{subagents.length}</span>
          {running > 0 && (
            <span className="shrink-0 text-accent-fg">
              {t(language, 'subagentsRunningCount', { count: String(running) })}
            </span>
          )}
          <span className="min-w-0 flex-1" />
          <button
            type="button"
            aria-expanded={expanded}
            title={t(language, expanded ? 'subagentsCollapse' : 'subagentsExpand')}
            onClick={() => setExpanded((value) => !value)}
            className="titlebar-no-drag shrink-0 text-muted transition-colors hover:text-primary"
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        </div>

        {expanded && (
          <ul className="mt-1.5 space-y-1 border-t border-border pt-1.5">
            {subagents.map((run) => (
              <SubagentRow key={run.id} run={run} language={language} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SubagentRow({
  run,
  language,
}: {
  run: SubagentRun
  language: Parameters<typeof t>[0]
}): React.JSX.Element {
  // `description` is the kernel's own label for the run; `task` is what the
  // parent asked for when it launched one. Either may be absent.
  const label = run.description ?? run.task

  return (
    <li className="flex items-baseline gap-2">
      <span className={`shrink-0 ${STATUS_CLASS[run.kind]}`}>{t(language, STATUS_KEY[run.kind])}</span>
      <span className="shrink-0 text-primary">{run.agent ?? run.id}</span>
      {label && (
        <span className="min-w-0 flex-1 truncate text-dim" title={label}>
          {label}
        </span>
      )}
    </li>
  )
}
