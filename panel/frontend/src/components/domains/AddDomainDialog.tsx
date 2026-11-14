import { useId, useState } from 'react'
import type { CloudflareZone } from '../../lib/domainsApi'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, Input, Select } from '../ui'

export interface AddDomainDialogProps {
  open: boolean
  zones: CloudflareZone[]
  busy?: boolean
  onCancel: () => void
  onSubmit: (payload: { name: string; zone_id: string }) => void
}

export function AddDomainDialog({
  open,
  zones,
  busy = false,
  onCancel,
  onSubmit,
}: AddDomainDialogProps) {
  const titleId = useId()
  const descId = useId()
  const [zoneId, setZoneId] = useState('')

  const effectiveZoneId = zoneId || zones[0]?.id || ''
  const domainName = zones.find((zone) => zone.id === effectiveZoneId)?.name ?? ''

  const canSubmit = Boolean(effectiveZoneId && domainName.trim() && !busy)

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
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <DialogTitle id={titleId}>Add domain</DialogTitle>
        <DialogDescription id={descId}>
          Register an apex zone for a wildcard certificate. Subdomain zones (for example{' '}
          <span className="font-mono text-foreground">app.example.com</span> as its own zone)
          are not supported in v1.
        </DialogDescription>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="add-domain-zone" className="text-sm font-medium text-foreground">
              Cloudflare zone
            </label>
            <Select
              id="add-domain-zone"
              value={effectiveZoneId}
              disabled={busy || zones.length === 0}
              onChange={(event) => setZoneId(event.target.value)}
            >
              <option value="">Select a zone…</option>
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="add-domain-name" className="text-sm font-medium text-foreground">
              Domain name
            </label>
            <Input
              id="add-domain-name"
              type="text"
              value={domainName}
              readOnly
              className="read-only:opacity-80"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!canSubmit}
            onClick={() => onSubmit({ name: domainName.trim(), zone_id: effectiveZoneId })}
          >
            Add domain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}