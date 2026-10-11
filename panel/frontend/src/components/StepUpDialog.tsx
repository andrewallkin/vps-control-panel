import { Spinner } from '@phosphor-icons/react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ApiError, stepUpRequest } from '../lib/api'

export interface StepUpDialogProps {
  open: boolean
  title?: string
  description?: string
  busy?: boolean
  onVerified: () => void
  onCancel: () => void
}

export function StepUpDialog({
  open,
  title = 'Confirm with authenticator',
  description = 'Enter the current 6-digit code from your authenticator app to continue.',
  busy = false,
  onVerified,
  onCancel,
}: StepUpDialogProps) {
  const titleId = useId()
  const descId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    inputRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy && !submitting) {
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, busy, submitting, onCancel])

  if (!open) {
    return null
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await stepUpRequest(code.trim())
      setCode('')
      onVerified()
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid code. Try again.')
      } else {
        setError('Could not verify. Try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = busy || submitting

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-background/80 cursor-pointer"
        aria-label="Dismiss dialog"
        disabled={disabled}
        onClick={onCancel}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative z-10 w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg"
        onSubmit={(event) => void onSubmit(event)}
      >
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <p id={descId} className="mt-2 text-sm text-muted-foreground">
          {description}
        </p>
        <div className="mt-4 space-y-2">
          <label htmlFor="step-up-code" className="text-sm font-medium">
            Authenticator code
          </label>
          <input
            ref={inputRef}
            id="step-up-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            disabled={disabled}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={disabled}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={disabled || code.trim().length !== 6}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50"
          >
            {submitting ? (
              <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
            ) : null}
            Verify
          </button>
        </div>
      </form>
    </div>
  )
}
