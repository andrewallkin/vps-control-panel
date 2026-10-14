import { useEffect, useId, useRef, useState } from 'react'

export interface RestoreConflict {
  databases: string[]
  roles: string[]
}

export interface RestoreConfirmDialogProps {
  open: boolean
  busy?: boolean
  conflict?: RestoreConflict | null
  attachedProjects?: string[]
  onConfirm: (overwrite: boolean) => void
  onCancel: () => void
}

export function RestoreConfirmDialog({
  open,
  busy = false,
  conflict = null,
  attachedProjects = [],
  onConfirm,
  onCancel,
}: RestoreConfirmDialogProps) {
  const titleId = useId()
  const descId = useId()
  const inputId = useId()
  const overwriteId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [confirmText, setConfirmText] = useState('')
  const [overwrite, setOverwrite] = useState(false)

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

  const canConfirm = confirmText === 'RESTORE' && !busy && (!conflict || overwrite)

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
        {conflict ? (
          <div className="mt-4 space-y-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3">
            <p className="text-sm font-medium text-destructive">
              The cluster already contains data that would be replaced:
            </p>
            <ul className="list-inside list-disc text-sm text-foreground">
              {[...conflict.databases, ...conflict.roles].map((name) => (
                <li key={name} className="font-mono">
                  {name}
                </li>
              ))}
            </ul>
            <label htmlFor={overwriteId} className="flex items-center gap-2 text-sm font-medium">
              <input
                id={overwriteId}
                type="checkbox"
                checked={overwrite}
                className="size-4 rounded border-border"
                onChange={(event) => setOverwrite(event.target.checked)}
              />
              Overwrite existing data
            </label>
          </div>
        ) : null}
        {attachedProjects.length > 0 ? (
          <div className="mt-4 space-y-2 rounded-lg border border-warning/50 bg-warning/10 px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              Attached projects keep the passwords stored by this panel
            </p>
            <p className="text-sm text-muted-foreground">
              The dump puts the old database role passwords back. Each app below will fail to
              connect until you rotate its database password and deploy.
            </p>
            <ul className="list-inside list-disc text-sm text-foreground">
              {attachedProjects.map((slug) => (
                <li key={slug} className="font-mono">
                  {slug}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            className="inline-flex items-center gap-2 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-foreground transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => onConfirm(overwrite)}
          >
            Restore cluster
          </button>
        </div>
      </div>
    </div>
  )
}
