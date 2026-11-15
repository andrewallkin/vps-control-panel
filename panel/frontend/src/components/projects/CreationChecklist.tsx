import { CheckCircle, Circle, CircleDashed, XCircle } from '@phosphor-icons/react'
import { Button } from '../ui'
import type { CreationStep } from '../../lib/projectsApi'

const STEP_LABELS: Record<string, string> = {
  register: 'Register project',
  deploy_key: 'Deploy key',
  clone: 'Clone repository',
  ports: 'Allocate ports',
  database: 'Database',
  env: 'Environment file',
  nginx: 'Nginx site',
  dns: 'DNS records',
}

export interface CreationChecklistProps {
  steps: CreationStep[]
  onRetry?: () => void
  retryPending?: boolean
}

export function CreationChecklist({ steps, onRetry, retryPending }: CreationChecklistProps) {
  const failedStep = steps.find((step) => step.status === 'failed')

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {steps.map((step) => {
          const icon =
            step.status === 'done' ? (
              <CheckCircle weight="regular" aria-hidden className="size-4 shrink-0 text-accent" />
            ) : step.status === 'failed' ? (
              <XCircle weight="regular" aria-hidden className="size-4 shrink-0 text-destructive" />
            ) : step.status === 'running' ? (
              <CircleDashed weight="regular" aria-hidden className="size-4 shrink-0 text-foreground" />
            ) : (
              <Circle weight="regular" aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            )
          return (
            <li key={step.name} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                {icon}
                <span className="text-sm font-medium">{STEP_LABELS[step.name] ?? step.name}</span>
              </div>
              {step.error ? (
                <p className="pl-7 text-sm text-destructive">{step.error}</p>
              ) : null}
            </li>
          )
        })}
      </ol>
      {failedStep && onRetry ? (
        <Button
          type="button"
          disabled={retryPending}
          loading={retryPending}
          onClick={onRetry}
        >
          {retryPending ? 'Retrying…' : 'Retry'}
        </Button>
      ) : null}
    </div>
  )
}