import { CheckCircle, Circle, CircleDashed } from '@phosphor-icons/react'

export type WizardStepId =
  | 'basics'
  | 'source'
  | 'domain'
  | 'database'
  | 'environment'
  | 'review'
  | 'progress'

const STEP_ORDER: WizardStepId[] = [
  'basics',
  'source',
  'domain',
  'database',
  'environment',
  'review',
  'progress',
]

const STEP_LABELS: Record<WizardStepId, string> = {
  basics: 'Basics',
  source: 'Source',
  domain: 'Domain & routes',
  database: 'Database',
  environment: 'Environment',
  review: 'Review',
  progress: 'Creating',
}

function stepState(
  stepId: WizardStepId,
  active: WizardStepId,
): 'done' | 'current' | 'upcoming' {
  const activeIndex = STEP_ORDER.indexOf(active)
  const stepIndex = STEP_ORDER.indexOf(stepId)
  if (stepIndex < activeIndex) {
    return 'done'
  }
  if (stepIndex === activeIndex) {
    return 'current'
  }
  return 'upcoming'
}

export interface ProjectWizardStepperProps {
  active: WizardStepId
}

export function ProjectWizardStepper({ active }: ProjectWizardStepperProps) {
  const visibleSteps = STEP_ORDER.filter((id) => id !== 'progress')

  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
      {visibleSteps.map((stepId, index) => {
        const state = stepState(stepId, active === 'progress' ? 'review' : active)
        const icon =
          state === 'done' ? (
            <CheckCircle weight="regular" aria-hidden className="size-4 shrink-0 text-accent" />
          ) : state === 'current' ? (
            <CircleDashed weight="regular" aria-hidden className="size-4 shrink-0 text-foreground" />
          ) : (
            <Circle weight="regular" aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          )
        return (
          <li key={stepId} className="flex min-w-0 items-center gap-2 sm:flex-1 sm:min-w-[7rem]">
            <div className="flex min-w-0 items-center gap-2">
              {icon}
              <span
                className={
                  state === 'upcoming'
                    ? 'text-sm text-muted-foreground'
                    : 'text-sm font-medium text-foreground'
                }
              >
                {STEP_LABELS[stepId]}
              </span>
            </div>
            {index < visibleSteps.length - 1 ? (
              <span aria-hidden className="hidden h-px flex-1 bg-border sm:block" />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
