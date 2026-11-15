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
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border-strong transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
        checked ? 'bg-accent' : 'bg-secondary',
        className,
      )}
      onClick={() => onCheckedChange(!checked)}
      {...props}
    >
      <span
        className={cn(
          'pointer-events-none block size-3.5 rounded-full bg-foreground transition-transform duration-150',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
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
