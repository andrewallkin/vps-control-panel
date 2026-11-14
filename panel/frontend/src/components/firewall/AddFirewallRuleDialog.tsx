import { useId, useState } from 'react'
import type { AddFirewallRulePayload } from '../../lib/firewallApi'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, Input, Select } from '../ui'

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

  const parsedPort = parsePortInput(port)
  const canSubmit = parsedPort !== null && source.trim().length > 0 && !busy

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
        <DialogTitle id={titleId}>Add firewall rule</DialogTitle>
        <DialogDescription id={descId}>
          Allow or deny traffic by port or range, protocol, and source CIDR.
        </DialogDescription>

        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="fw-add-port" className="text-sm font-medium text-foreground">
              Port or range
            </label>
            <Input
              id="fw-add-port"
              type="text"
              inputMode="numeric"
              placeholder="80 or 8000:8010"
              value={port}
              disabled={busy}
              mono
              onChange={(event) => setPort(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="fw-add-proto" className="text-sm font-medium text-foreground">
              Protocol
            </label>
            <Select
              id="fw-add-proto"
              value={proto}
              disabled={busy}
              onChange={(event) => setProto(event.target.value as 'tcp' | 'udp')}
            >
              <option value="tcp">tcp</option>
              <option value="udp">udp</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="fw-add-action" className="text-sm font-medium text-foreground">
              Action
            </label>
            <Select
              id="fw-add-action"
              value={action}
              disabled={busy}
              onChange={(event) => setAction(event.target.value as 'allow' | 'deny')}
            >
              <option value="allow">allow</option>
              <option value="deny">deny</option>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="fw-add-source" className="text-sm font-medium text-foreground">
              Source
            </label>
            <Input
              id="fw-add-source"
              type="text"
              placeholder="any or 203.0.113.0/24"
              value={source}
              disabled={busy}
              mono
              onChange={(event) => setSource(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="fw-add-comment" className="text-sm font-medium text-foreground">
              Comment <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="fw-add-comment"
              type="text"
              value={comment}
              disabled={busy}
              onChange={(event) => setComment(event.target.value)}
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
            Add rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}