import { AlertCircle, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import type { SessionRuntimeInfo } from '../../../shared/ipc-contracts'
import { DEFAULT_AGENT_ENGINE_LABEL, agentEngineLabel } from '../../../shared/agent-engine-label'

export function SessionRuntimeIndicator({ runtime }: { runtime: SessionRuntimeInfo }): React.JSX.Element | null {
  const working = runtime.activity === 'working' || runtime.status === 'starting'
  const needsApproval = runtime.activity === 'needs-approval'
  const completed = runtime.activity === 'completed'
  const failed = runtime.activity === 'failed' || runtime.status === 'error'
  const idle = runtime.status === 'running' && !working && !needsApproval && !completed && !failed
  // Each runtime names its own engine: the sidebar can show a Pi session and an
  // OMP session at once, so a screen reader must not call both of them Pi.
  const agent = agentEngineLabel(runtime.engine) ?? DEFAULT_AGENT_ENGINE_LABEL

  if (working) {
    // A thin spinning arc — the shape the rest of the app uses for "working"
    // (streaming bubble, empty state, tool rows). It has to be *visible*: a muted
    // 12 px spinner in a grey list read as "no indicator at all" next to the
    // spinning ball it replaced, so it takes the accent colour the app uses for
    // live things.
    return (
      <Loader2
        size={13}
        className="shrink-0 animate-spin text-accent-fg"
        aria-label={`${agent} is working`}
      />
    )
  }
  if (idle) {
    // The kernel for this session is up but has nothing to do. A hollow ring
    // rather than a filled dot: it is a state worth seeing (that session has a
    // live process) without competing with the sessions that are actually busy.
    return (
      <span
        className="block h-2.5 w-2.5 shrink-0 rounded-full border border-border-strong-hover"
        aria-label={`${agent} is running`}
      />
    )
  }
  if (needsApproval) {
    return <AlertCircle size={12} className="shrink-0 text-warning" aria-label={`${agent} is waiting for approval`} />
  }
  if (completed) {
    return <CheckCircle2 size={12} className="shrink-0 text-success" aria-label={`${agent} finished`} />
  }
  if (failed) {
    return <XCircle size={12} className="shrink-0 text-error" aria-label={`${agent} stopped with an error`} />
  }
  return null
}
