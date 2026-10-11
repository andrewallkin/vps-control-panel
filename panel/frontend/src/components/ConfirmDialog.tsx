import { useEffect, useId, useRef } from 'react'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

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
          {title}
        </h2>
        <p id={descId} className="mt-2 text-sm text-muted-foreground">
          {description}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
