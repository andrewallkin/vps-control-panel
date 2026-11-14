import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ApiError, stepUpRequest } from '../lib/api'
import { Button } from './ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from './ui/Dialog'
import { Input } from './ui/Input'

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
  }, [open])

  const disabled = busy || submitting

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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !disabled) {
          onCancel()
        }
      }}
    >
      <DialogContent
        busy={disabled}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <form onSubmit={(event) => void onSubmit(event)}>
          <DialogTitle id={titleId}>{title}</DialogTitle>
          <DialogDescription id={descId}>{description}</DialogDescription>
          <div className="mt-4 space-y-2">
            <label htmlFor="step-up-code" className="text-sm font-medium">
              Authenticator code
            </label>
            <Input
              ref={inputRef}
              id="step-up-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              disabled={disabled}
              mono
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'step-up-code-error' : undefined}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            />
            {error ? (
              <p id="step-up-code-error" className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={disabled} onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={disabled || code.trim().length !== 6}>
              Verify
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}