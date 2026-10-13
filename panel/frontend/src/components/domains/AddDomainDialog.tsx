import { Spinner } from '@phosphor-icons/react'
import { useId, useState } from 'react'
import type { CloudflareZone } from '../../lib/domainsApi'

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

  if (!open) {
    return null
  }

  const canSubmit = Boolean(effectiveZoneId && domainName.trim() && !busy)

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
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="relative z-10 w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-lg"
      >
        <h2 id={titleId} className="text-base font-semibold">
          Add domain
        </h2>
        <p id={descId} className="mt-2 text-sm text-muted-foreground">
          Register an apex zone for a wildcard certificate. Subdomain zones (for example{' '}
          <span className="font-mono text-foreground">app.example.com</span> as its own zone)
          are not supported in v1.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="add-domain-zone" className="block text-sm font-medium">
              Cloudflare zone
            </label>
            <select
              id="add-domain-zone"
              value={effectiveZoneId}
              disabled={busy || zones.length === 0}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              onChange={(event) => setZoneId(event.target.value)}
            >
              <option value="">Select a zone…</option>
              {zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="add-domain-name" className="block text-sm font-medium">
              Domain name
            </label>
            <input
              id="add-domain-name"
              type="text"
              value={domainName}
              readOnly
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground read-only:opacity-80"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() =>
              onSubmit({ name: domainName.trim(), zone_id: effectiveZoneId })
            }
          >
            {busy ? (
              <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
            ) : null}
            Add domain
          </button>
        </div>
      </div>
    </div>
  )
}
