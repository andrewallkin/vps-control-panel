import { CheckCircle, Circle, CircleDashed } from '@phosphor-icons/react'
import type { SetupStep, SetupStepId } from '../../lib/setupApi'

export type WizardStepId = SetupStepId | 'finish'

export interface SetupStepperProps {
  active: WizardStepId
  steps: SetupStep[]
  hasValidCert?: boolean
}

const stepOrder: WizardStepId[] = [
  'account',
  'database',
  'cloudflare',
  'domains',
  'panel_hostname',
  'finish',
]

const stepLabels: Record<WizardStepId, string> = {
  account: 'Account',
  database: 'Database',
  cloudflare: 'Cloudflare',
  domains: 'Domains',
  panel_hostname: 'Panel hostname',
  finish: 'Finish',
}

function stepStatus(steps: SetupStep[], id: SetupStepId): string {
  return steps.find((step) => step.id === id)?.status ?? 'pending'
}

function stepState(
  stepId: WizardStepId,
  active: WizardStepId,
  steps: SetupStep[],
  hasValidCert: boolean,
): 'done' | 'current' | 'upcoming' {
  const activeIndex = stepOrder.indexOf(active)
  const stepIndex = stepOrder.indexOf(stepId)

  if (stepId === 'account') {
    return 'done'
  }

  if (stepId === 'finish') {
    const panelDone = stepStatus(steps, 'panel_hostname') === 'done'
    if (!panelDone) {
      return stepIndex <= activeIndex ? 'current' : 'upcoming'
    }
    return active === 'finish' ? 'current' : 'done'
  }

  const id = stepId as SetupStepId
  const status = stepStatus(steps, id)
  const done =
    id === 'database'
      ? status !== 'pending'
      : id === 'domains'
        ? status === 'done' && hasValidCert
        : status === 'done'

  if (done) {
    return 'done'
  }
  return stepIndex === activeIndex ? 'current' : stepIndex < activeIndex ? 'current' : 'upcoming'
}

export function SetupStepper({ active, steps, hasValidCert = false }: SetupStepperProps) {
  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
      {stepOrder.map((stepId, index) => {
        const state = stepState(stepId, active, steps, hasValidCert)
        const icon =
          state === 'done' ? (
            <CheckCircle weight="regular" aria-hidden className="size-5 shrink-0 text-accent" />
          ) : state === 'current' ? (
            <CircleDashed weight="regular" aria-hidden className="size-5 shrink-0 text-foreground" />
          ) : (
            <Circle weight="regular" aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          )

        return (
          <li key={stepId} className="flex min-w-0 items-center gap-2 sm:flex-1 sm:min-w-[8rem]">
            <div className="flex min-w-0 items-center gap-2">
              {icon}
              <span
                className={
                  state === 'upcoming'
                    ? 'text-sm text-muted-foreground'
                    : 'text-sm font-medium text-foreground'
                }
              >
                {stepLabels[stepId]}
                {stepId === 'account' ? (
                  <span className="sr-only">, completed</span>
                ) : null}
              </span>
            </div>
            {index < stepOrder.length - 1 ? (
              <span aria-hidden className="hidden h-px flex-1 bg-border sm:block" />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
