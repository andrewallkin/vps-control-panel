export const RESOURCE_WARNING_PERCENT = 80
export const RESOURCE_DANGER_PERCENT = 90

export function percentStressClass(value: number): string {
  if (!Number.isFinite(value)) {
    return 'text-foreground'
  }
  if (value > RESOURCE_DANGER_PERCENT) {
    return 'text-destructive'
  }
  if (value > RESOURCE_WARNING_PERCENT) {
    return 'text-warning'
  }
  return 'text-foreground'
}
