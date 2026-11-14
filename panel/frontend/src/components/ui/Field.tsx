import { useId, type ReactElement } from 'react'
import { cn } from '../../lib/cn'

export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

export interface FieldProps {
  label: string
  hint?: string
  error?: string
  className?: string
  children: (props: FieldControlProps) => ReactElement
}

export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId()
  const hintId = useId()
  const errorId = useId()

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
