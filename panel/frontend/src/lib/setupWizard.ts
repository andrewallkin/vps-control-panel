import type { SetupStep, UploadCompleteInfo } from './setupApi'
import type { WizardStepId } from '../components/setup/SetupStepper'

function stepStatus(steps: SetupStep[], id: SetupStep['id']): string {
  return steps.find((step) => step.id === id)?.status ?? 'pending'
}

export interface ResolveActiveStepOptions {
  cloudflareAcknowledged?: boolean
  panelHostnameAcknowledged?: boolean
}

export function resolveActiveStep(
  steps: SetupStep[],
  hasValidCert: boolean,
  restoreJobId: string | null,
  uploading: boolean,
  uploadInfo: UploadCompleteInfo | null,
  options: ResolveActiveStepOptions = {},
): WizardStepId {
  const cloudflareAcknowledged = options.cloudflareAcknowledged ?? true
  const panelHostnameAcknowledged = options.panelHostnameAcknowledged ?? true

  const databaseStatus = stepStatus(steps, 'database')
  if (databaseStatus === 'pending' || uploading || uploadInfo || restoreJobId) {
    return 'database'
  }

  const cloudflareDone = stepStatus(steps, 'cloudflare') === 'done'
  if (!cloudflareDone || !cloudflareAcknowledged) {
    return 'cloudflare'
  }

  if (!hasValidCert) {
    return 'domains'
  }

  const panelHostnameDone = stepStatus(steps, 'panel_hostname') === 'done'
  if (!panelHostnameDone || !panelHostnameAcknowledged) {
    return 'panel_hostname'
  }

  return 'finish'
}
