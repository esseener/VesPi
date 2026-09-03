import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'

export interface ThemedSelectOption {
  value: string
  label: string
  disabled?: boolean
}

export function ThemedSelect({
  value,
  options,
  onChange,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: {
  value: string
  options: ThemedSelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => { if (!disabled) setOpen((next) => !next) }}
        className={clsx(
          'flex w-full items-center justify-between gap-2 rounded-md border bg-transparent py-1.5 pl-3 pr-2 text-left text-sm text-primary transition-colors',
          open ? 'border-accent-fg' : 'border-border-strong hover:border-border-strong-hover',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span className="min-w-0 truncate">{current?.label ?? ''}</span>
        <ChevronDown size={14} className={clsx('shrink-0 text-dim transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-[80] mt-1 max-h-60 overflow-y-auto rounded-lg border border-border-strong bg-app py-1 shadow-xl shadow-black/50">
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                disabled={option.disabled}
                onClick={() => {
                  if (option.disabled) return
                  onChange(option.value)
                  setOpen(false)
                }}
                className={clsx(
                  'flex w-full px-3 py-1.5 text-left text-sm transition-colors',
                  selected ? 'bg-surface text-primary' : 'text-secondary hover:bg-surface-hover hover:text-primary',
                  option.disabled && 'cursor-not-allowed opacity-40',
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
