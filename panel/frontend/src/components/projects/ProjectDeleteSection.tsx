import { useId, useState } from 'react'
import { StepUpDialog } from '../StepUpDialog'
import type { DeleteProjectPayload } from '../../lib/projectDeployTypes'

export interface ProjectDeleteSectionProps {
  slug: string
  onDelete: (payload: DeleteProjectPayload) => void | Promise<void>
  busy?: boolean
  error?: string | null
}

export function ProjectDeleteSection({
  slug,
  onDelete,
  busy = false,
  error = null,
}: ProjectDeleteSectionProps) {
  const inputId = useId()
  const [confirmText, setConfirmText] = useState('')
  const [dropDatabase, setDropDatabase] = useState(false)
  const [removeDns, setRemoveDns] = useState(false)
  const [stepUpOpen, setStepUpOpen] = useState(false)

  const canDelete = confirmText === slug && !busy

  const performDelete = () => {
    void onDelete({
      confirm: slug,
      drop_database: dropDatabase,
      remove_dns: removeDns,
    })
    setStepUpOpen(false)
  }

  return (
    <div className="space-y-4 rounded-md border border-destructive/40 bg-card p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-destructive">Delete project</h2>
        <p className="text-sm text-muted-foreground">
          This removes the project from the panel and agent. Type{' '}
          <span className="font-mono text-foreground">{slug}</span> to confirm.
        </p>
      </div>
      <label className="block text-sm font-medium" htmlFor={inputId}>
        Type slug to confirm
      </label>
      <input
        id={inputId}
        type="text"
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
        value={confirmText}
        onChange={(event) => setConfirmText(event.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
      />
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={dropDatabase}
            disabled={busy}
            onChange={(event) => setDropDatabase(event.target.checked)}
          />
          Drop database
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={removeDns}
            disabled={busy}
            onChange={(event) => setRemoveDns(event.target.checked)}
          />
          Remove DNS records
        </label>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <button
        type="button"
        disabled={!canDelete}
        className="rounded-md bg-destructive px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 disabled:opacity-50 cursor-pointer"
        onClick={() => setStepUpOpen(true)}
      >
        Delete project
      </button>
      <StepUpDialog
        open={stepUpOpen}
        title="Confirm project deletion"
        description="Enter your authenticator code to delete this project."
        busy={busy}
        onVerified={performDelete}
        onCancel={() => setStepUpOpen(false)}
      />
    </div>
  )
}
