import { useEffect, useId, useRef, useState } from 'react'

export interface RestoreConfirmDialogProps {
  open: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function RestoreConfirmDialog({
  open,
  busy = false,
  onConfirm,
  onCancel,
}: RestoreConfirmDialogProps) {
  const titleId = useId()
  const descId = useId()
  const inputId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [confirmText, setConfirmText] = useState('')

  useEffect(() => {
    if (!open) {
      return
    }
    cancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onCancel])

  if (!open) {
    return null
  }

  const canConfirm = confirmText === 'RESTORE' && !busy

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-background/80 cursor-pointer"
        aria-label="Dismiss dialog"
        disabled={busy}
        onClick={onCancel}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative z-10 w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg"
      >
        <h2 id={titleId} className="text-base font-semibold">
          Confirm cluster restore
        </h2>
        <p id={descId} className="mt-2 text-sm text-muted-foreground">
          This will load the uploaded dump into the central PostgreSQL cluster. Type{' '}
          <span className="font-mono text-foreground">RESTORE</span> to confirm.
        </p>
        <label htmlFor={inputId} className="mt-4 block text-sm font-medium">
          Confirmation
        </label>
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
        />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50"
            onClick={onConfirm}
          >
            Restore cluster
          </button>
        </div>
      </div>
    </div>
  )
}
