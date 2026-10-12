import { Spinner } from '@phosphor-icons/react'
import { useId, useState } from 'react'
import type { AddFirewallRulePayload } from '../../lib/firewallApi'

export interface AddFirewallRuleDialogProps {
  open: boolean
  busy?: boolean
  onCancel: () => void
  onSubmit: (payload: AddFirewallRulePayload) => void
}

function parsePortInput(raw: string): number | string | null {
  const value = raw.trim()
  if (!value) {
    return null
  }
  if (/^\d+$/.test(value)) {
    return Number(value)
  }
  if (/^\d+:\d+$/.test(value)) {
    return value
  }
  return null
}

export function AddFirewallRuleDialog({
  open,
  busy = false,
  onCancel,
  onSubmit,
}: AddFirewallRuleDialogProps) {
  const titleId = useId()
  const descId = useId()
  const [port, setPort] = useState('')
  const [proto, setProto] = useState<'tcp' | 'udp'>('tcp')
  const [action, setAction] = useState<'allow' | 'deny'>('allow')
  const [source, setSource] = useState('any')
  const [comment, setComment] = useState('')

  if (!open) {
    return null
  }

  const parsedPort = parsePortInput(port)
  const canSubmit = parsedPort !== null && source.trim().length > 0 && !busy

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
          Add firewall rule
        </h2>
        <p id={descId} className="mt-2 text-sm text-muted-foreground">
          Allow or deny traffic by port or range, protocol, and source CIDR.
        </p>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <label htmlFor="fw-add-port" className="text-sm font-medium">
              Port or range
            </label>
            <input
              id="fw-add-port"
              type="text"
              inputMode="numeric"
              placeholder="80 or 8000:8010"
              value={port}
              disabled={busy}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
              onChange={(event) => setPort(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="fw-add-proto" className="text-sm font-medium">
              Protocol
            </label>
            <select
              id="fw-add-proto"
              value={proto}
              disabled={busy}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              onChange={(event) => setProto(event.target.value as 'tcp' | 'udp')}
            >
              <option value="tcp">tcp</option>
              <option value="udp">udp</option>
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="fw-add-action" className="text-sm font-medium">
              Action
            </label>
            <select
              id="fw-add-action"
              value={action}
              disabled={busy}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              onChange={(event) => setAction(event.target.value as 'allow' | 'deny')}
            >
              <option value="allow">allow</option>
              <option value="deny">deny</option>
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="fw-add-source" className="text-sm font-medium">
              Source
            </label>
            <input
              id="fw-add-source"
              type="text"
              placeholder="any or 203.0.113.0/24"
              value={source}
              disabled={busy}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
              onChange={(event) => setSource(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="fw-add-comment" className="text-sm font-medium">
              Comment <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="fw-add-comment"
              type="text"
              value={comment}
              disabled={busy}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50"
            onClick={() => {
              if (parsedPort === null) {
                return
              }
              onSubmit({
                port: parsedPort,
                proto,
                action,
                source: source.trim(),
                comment: comment.trim(),
              })
            }}
          >
            {busy ? (
              <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
            ) : null}
            Add rule
          </button>
        </div>
      </div>
    </div>
  )
}
