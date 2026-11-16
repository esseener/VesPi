import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { OverlayPortal } from './overlay-portal'
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
  const popupRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<React.CSSProperties>({})
  const current = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node) && !popupRef.current?.contains(event.target as Node)) setOpen(false)
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

  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const below = window.innerHeight - rect.bottom - 12
      const above = rect.top - 12
      const up = below < 160 && above > below
      const width = Math.min(Math.max(160, rect.width), window.innerWidth - 16)
      setPosition({ width, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), maxHeight: Math.max(40, Math.min(240, up ? above : below)), ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) })
    }
    place()
    window.addEventListener('resize', place)
    const scroll = (event: Event): void => { if (!popupRef.current?.contains(event.target as Node)) place() }
    window.addEventListener('scroll', scroll, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true) }
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
      {open && <OverlayPortal>
        <div ref={popupRef} style={position} role="listbox" aria-label={ariaLabel} className="fixed z-[80] overflow-y-auto rounded-lg border border-border-strong bg-app py-1 shadow-xl shadow-black/50">
          {options.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
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
      </OverlayPortal>}
    </div>
  )
}
