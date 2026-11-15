import { useId, useState } from 'react'
import { StepUpDialog } from '../StepUpDialog'
import { Button, Card, CardBody, Checkbox, Input } from '../ui'
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
    <Card className="space-y-4 border-destructive/40 p-4">
      <CardBody className="space-y-4 p-0">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-destructive">Delete project</h2>
          <p className="text-sm text-muted-foreground">
            This removes the project from the panel and agent. Type{' '}
            <span className="font-mono text-foreground">{slug}</span> to confirm.
          </p>
        </div>
        <label className="block text-sm font-medium" htmlFor={inputId}>
          Type slug to confirm
        </label>
        <Input
          id={inputId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          mono
          className="mt-1"
          value={confirmText}
          onChange={(event) => setConfirmText(event.target.value)}
        />
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={dropDatabase}
              disabled={busy}
              onChange={(event) => setDropDatabase(event.target.checked)}
            />
            Drop database
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={removeDns}
              disabled={busy}
              onChange={(event) => setRemoveDns(event.target.checked)}
            />
            Remove DNS records
          </label>
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">{error}</p>
        ) : null}
        <Button
          type="button"
          variant="danger"
          disabled={!canDelete}
          onClick={() => setStepUpOpen(true)}
        >
          {busy ? 'Deleting…' : 'Delete project'}
        </Button>
      </CardBody>
      <StepUpDialog
        open={stepUpOpen}
        title="Confirm project deletion"
        description="Enter your authenticator code to delete this project."
        busy={busy}
        onVerified={performDelete}
        onCancel={() => setStepUpOpen(false)}
      />
    </Card>
  )
}