import { CheckCircle, Circle, CircleDashed } from '@phosphor-icons/react'

export type WizardStepId = 'account' | 'database' | 'finish'

export interface SetupStepperProps {
  active: WizardStepId
  databaseStatus: string
}

const steps: { id: WizardStepId; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'database', label: 'Database' },
  { id: 'finish', label: 'Finish' },
]

function stepState(
  stepId: WizardStepId,
  active: WizardStepId,
  databaseStatus: string,
): 'done' | 'current' | 'upcoming' {
  const order: WizardStepId[] = ['account', 'database', 'finish']
  const activeIndex = order.indexOf(active)
  const stepIndex = order.indexOf(stepId)

  if (stepId === 'account') {
    return 'done'
  }
  if (stepId === 'database') {
    if (databaseStatus !== 'pending') {
      return 'done'
    }
    return active === 'database' ? 'current' : stepIndex <= activeIndex ? 'current' : 'upcoming'
  }
  if (databaseStatus !== 'pending') {
    return active === 'finish' ? 'current' : 'done'
  }
  return stepIndex <= activeIndex ? 'current' : 'upcoming'
}

export function SetupStepper({ active, databaseStatus }: SetupStepperProps) {
  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
      {steps.map((step, index) => {
        const state = stepState(step.id, active, databaseStatus)
        const icon =
          state === 'done' ? (
            <CheckCircle weight="regular" aria-hidden className="size-5 shrink-0 text-accent" />
          ) : state === 'current' ? (
            <CircleDashed weight="regular" aria-hidden className="size-5 shrink-0 text-foreground" />
          ) : (
            <Circle weight="regular" aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          )

        return (
          <li key={step.id} className="flex min-w-0 items-center gap-2 sm:flex-1">
            <div className="flex min-w-0 items-center gap-2">
              {icon}
              <span
                className={
                  state === 'upcoming'
                    ? 'text-sm text-muted-foreground'
                    : 'text-sm font-medium text-foreground'
                }
              >
                {step.label}
                {step.id === 'account' ? (
                  <span className="sr-only">, completed</span>
                ) : null}
              </span>
            </div>
            {index < steps.length - 1 ? (
              <span
                aria-hidden
                className="hidden h-px flex-1 bg-border sm:block"
              />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
