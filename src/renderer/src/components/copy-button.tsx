import { useState } from 'react'
import { clsx } from 'clsx'
import { Copy, Check } from 'lucide-react'
import { useAppStore } from '../store'
import { DEFAULT_LANGUAGE, t } from '../../../shared/i18n'

export function CopyButton({
  text,
  className,
}: {
  text: string
  className?: string
}): React.JSX.Element {
  const language = useAppStore(
    (state) => state.settingsDraft.language ?? state.settings?.language ?? DEFAULT_LANGUAGE
  )
  const [copied, setCopied] = useState(false)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      onClick={handleCopy}
      title={copied ? t(language, 'copied') : t(language, 'copy')}
      aria-label={copied ? t(language, 'copied') : t(language, 'copy')}
      className={clsx(
        'z-10 rounded p-1 text-dim transition-colors hover:bg-surface-hover hover:text-primary',
        className
      )}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}
