import { useId, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, Field, Input } from '../ui'
import { cn } from '../../lib/cn'

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
  const overwriteId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [confirmText, setConfirmText] = useState('')
  const [overwrite, setOverwrite] = useState(false)

  const canConfirm = confirmText === 'RESTORE' && !busy && (!conflict || overwrite)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          onCancel()
        }
      }}
    >
      <DialogContent
        busy={busy}
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <DialogTitle id={titleId}>Confirm cluster restore</DialogTitle>
        <DialogDescription id={descId}>
          This will load the uploaded dump into the central PostgreSQL cluster. Type{' '}
          <span className="font-mono text-foreground">RESTORE</span> to confirm.
        </DialogDescription>
        {conflict ? (
          <Alert tone="danger" className="mt-4" title="The cluster already contains data that would be replaced:">
            <ul className="list-inside list-disc">
              {[...conflict.databases, ...conflict.roles].map((name) => (
                <li key={name} className="font-mono">
                  {name}
                </li>
              ))}
            </ul>
            <label htmlFor={overwriteId} className="mt-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <Checkbox
                id={overwriteId}
                checked={overwrite}
                onChange={(event) => setOverwrite(event.target.checked)}
              />
              Overwrite existing data
            </label>
          </Alert>
        ) : null}
        {attachedProjects.length > 0 ? (
          <Alert tone="warning" className="mt-4" title="Attached projects keep the passwords stored by this panel">
            <p>
              The dump puts the old database role passwords back. Each app below will fail to
              connect until you rotate its database password and deploy.
            </p>
            <ul className="list-inside list-disc">
              {attachedProjects.map((slug) => (
                <li key={slug} className="font-mono">
                  {slug}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <div className="mt-4">
          <Field label="Confirmation">
            {(control) => (
              <Input
                {...control}
                type="text"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                mono
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
              />
            )}
          </Field>
        </div>
        <DialogFooter>
          <Button ref={cancelRef} variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!canConfirm}
            loading={busy}
            className={cn('bg-destructive text-foreground hover:bg-destructive/90')}
            onClick={() => onConfirm(overwrite)}
          >
            Restore cluster
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}