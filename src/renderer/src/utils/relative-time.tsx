import { createContext, useContext } from 'react'
import { formatRelativeTime } from './format-relative-time'
import { useAppStore } from '../store'
import { DEFAULT_LANGUAGE } from '../../../shared/i18n'

export { formatRelativeTime }

/**
 * A single "now" value, refreshed on an interval by the chat panel, so all
 * relative-time labels tick together without each one owning a timer.
 */
export const NowContext = createContext<number>(Date.now())

/**
 * Renders a relative-time label that re-renders on each tick of `NowContext`.
 */
export function RelativeTime({ timestamp }: { timestamp: number }): React.JSX.Element {
  const now = useContext(NowContext)
  const language = useAppStore((state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE)
  return <span>{formatRelativeTime(timestamp, now, language)}</span>
}
