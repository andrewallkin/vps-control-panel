import { ConfirmDialog } from '../ConfirmDialog'

export interface RemoveDomainDialogProps {
  open: boolean
  domainName: string | null
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function RemoveDomainDialog({
  open,
  domainName,
  busy = false,
  onCancel,
  onConfirm,
}: RemoveDomainDialogProps) {
  if (!domainName) {
    return null
  }

  return (
    <ConfirmDialog
      open={open}
      title="Remove domain"
      description={`Remove ${domainName} from the panel? This deletes the registered domain and does not remove DNS records in Cloudflare.`}
      confirmLabel="Remove domain"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  )
}
