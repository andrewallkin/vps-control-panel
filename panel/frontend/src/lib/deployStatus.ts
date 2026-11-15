import type { BadgeTone } from '../components/ui/Badge'

export function deployStatusLabel(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'Succeeded'
    case 'failed':
      return 'Failed'
    case 'failed_after_switch':
      return 'Failed after switch'
    case 'running':
      return 'Running'
    case 'cancelled':
      return 'Cancelled'
    default:
      return status.replaceAll('_', ' ')
  }
}

export function deployStatusTone(status: string): BadgeTone {
  switch (status) {
    case 'succeeded':
      return 'success'
    case 'failed':
    case 'failed_after_switch':
    case 'cancelled':
      return 'danger'
    case 'running':
      return 'info'
    default:
      return 'warning'
  }
}
