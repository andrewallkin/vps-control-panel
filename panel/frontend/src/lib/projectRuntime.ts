import type { ComposePsService } from './projectDeployTypes'
import type { BadgeTone } from '../components/ui/Badge'
import type { ProjectRuntimeStatus } from './projectsApi'

export function runtimeStatusFromComposeServices(
  services: ComposePsService[] | undefined,
): ProjectRuntimeStatus {
  const list = services ?? []
  if (list.length === 0) {
    return 'stopped'
  }
  const anyRunning = list.some((svc) => svc.state === 'running')
  if (!anyRunning) {
    return 'stopped'
  }
  for (const svc of list) {
    if (svc.state !== 'running' || svc.health === 'unhealthy') {
      return 'degraded'
    }
  }
  return 'running'
}

export function runtimeStatusLabel(status: ProjectRuntimeStatus | null | undefined): string {
  if (!status) {
    return ''
  }
  switch (status) {
    case 'running':
      return 'Running'
    case 'degraded':
      return 'Degraded'
    case 'stopped':
      return 'Stopped'
    case 'not_deployed':
      return 'Not deployed'
    default:
      return status
  }
}

export function runtimeStatusTone(status: ProjectRuntimeStatus | null | undefined): BadgeTone {
  switch (status) {
    case 'running':
      return 'success'
    case 'degraded':
      return 'warning'
    case 'stopped':
    case 'not_deployed':
      return 'neutral'
    default:
      return 'neutral'
  }
}
