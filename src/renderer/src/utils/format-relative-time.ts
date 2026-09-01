import { DEFAULT_LANGUAGE, t, type AppLanguage } from '../../../shared/i18n'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A friendly relative-time label capped at days — never a coarser unit than
 * "days". Beyond ~30 days it falls back to an absolute date.
 * `now` is passed in so a single shared ticker can drive every label.
 */
export function formatRelativeTime(
  timestamp: number,
  now: number,
  language: AppLanguage = DEFAULT_LANGUAGE,
): string {
  const diff = now - timestamp
  // Clock skew / not-yet timestamps: treat as just now rather than "in -3s".
  if (diff < 45 * SECOND) return t(language, 'timeJustNow')
  if (diff < 90 * SECOND) return t(language, 'timeMinuteAgo')
  if (diff < HOUR) return t(language, 'timeMinutesAgo', { n: String(Math.floor(diff / MINUTE)) })
  if (diff < 2 * HOUR) return t(language, 'timeHourAgo')
  if (diff < DAY) return t(language, 'timeHoursAgo', { n: String(Math.floor(diff / HOUR)) })
  if (diff < 2 * DAY) return t(language, 'timeYesterday')
  if (diff < 30 * DAY) return t(language, 'timeDaysAgo', { n: String(Math.floor(diff / DAY)) })

  const d = new Date(timestamp)
  if (language === 'zh') {
    return t(language, 'timeDate', {
      month: String(d.getMonth() + 1),
      day: String(d.getDate()),
      year: String(d.getFullYear()),
    })
  }
  return t(language, 'timeDate', {
    month: EN_MONTHS[d.getMonth()],
    day: String(d.getDate()),
    year: String(d.getFullYear()),
  })
}
