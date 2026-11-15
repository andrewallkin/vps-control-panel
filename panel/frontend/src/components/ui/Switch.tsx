import { forwardRef, useId, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'role' | 'onChange'> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label?: string
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    checked,
    onCheckedChange,
    className,
    disabled,
    label,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    ...props
  },
  ref,
) {
  const labelId = useId()

  const control = (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      aria-label={label ? undefined : ariaLabel}
      aria-labelledby={label ? labelId : ariaLabelledBy}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
        checked ? 'border-accent bg-accent' : 'bg-muted',
        className,
      )}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    >
      <span
        className={cn(
          'pointer-events-none block size-4 rounded-full bg-card shadow-sm transition-transform duration-150',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )

  if (!label) {
    return control
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {control}
      <span id={labelId} className="text-foreground">
        {label}
      </span>
    </div>
  )
})
