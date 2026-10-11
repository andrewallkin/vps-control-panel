import type { StatusVariant } from '../components/StatusBadge'

export function composeServiceStatusVariant(state: string, health: string): StatusVariant {
  if (health === 'unhealthy') {
    return 'critical'
  }
  if (state === 'running') {
    return 'healthy'
  }
  return 'warning'
}
