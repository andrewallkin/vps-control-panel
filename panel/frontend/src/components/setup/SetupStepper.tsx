import { Check, CircleDashed } from '@phosphor-icons/react'
import type { SetupStep, SetupStepId } from '../../lib/setupApi'
import { cn } from '../../lib/cn'

export type WizardStepId = SetupStepId | 'optional' | 'finish'

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
  'optional',
  'finish',
]

const stepLabels: Record<WizardStepId, string> = {
  account: 'Account',
  database: 'Database',
  cloudflare: 'Cloudflare',
  domains: 'Domains',
  panel_hostname: 'Panel hostname',
  optional: 'Optional',
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

  if (stepId === 'optional') {
    if (active === 'finish' || active === 'optional') {
      return active === 'optional' ? 'current' : 'done'
    }
    return 'upcoming'
  }

  if (stepId === 'finish') {
    return active === 'finish' ? 'current' : 'upcoming'
  }

  const id = stepId as SetupStepId
  const status = stepStatus(steps, id)
  const done =
    id === 'database'
      ? status !== 'pending'
      : id === 'domains'
        ? hasValidCert
        : status === 'done'

  if (done) {
    return 'done'
  }
  return stepIndex === activeIndex ? 'current' : 'upcoming'
}

function StepIcon({
  state,
  index,
}: {
  state: 'done' | 'current' | 'upcoming'
  index: number
}) {
  if (state === 'done') {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft">
        <Check weight="bold" aria-hidden className="size-4 text-accent" />
      </span>
    )
  }
  if (state === 'current') {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-accent bg-accent-soft/50">
        <CircleDashed weight="bold" aria-hidden className="size-4 text-foreground" />
      </span>
    )
  }
  return (
    <span
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium tabular-nums text-muted-foreground',
      )}
    >
      {index + 1}
    </span>
  )
}

export function SetupStepper({ active, steps, hasValidCert = false }: SetupStepperProps) {
  return (
    <ol className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
      {stepOrder.map((stepId, index) => {
        const state = stepState(stepId, active, steps, hasValidCert)

        return (
          <li
            key={stepId}
            aria-current={state === 'current' ? 'step' : undefined}
            className="flex min-w-0 items-center gap-2 sm:flex-1 sm:min-w-[8rem]"
          >
            <div className="flex min-w-0 items-center gap-2">
              <StepIcon state={state} index={index} />
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