import type { EnvRow } from './envEditorUtils'
import { isEnvKeyLocked, isMaskedEnvPlaceholder } from './envEditorUtils'
import type { ProjectEnvEntry } from './projectDeployTypes'

export function entriesToEnvRows(
  entries: ProjectEnvEntry[],
  routePortEnvVars: string[],
): EnvRow[] {
  return entries.map((entry) => ({
    key: entry.key,
    value: entry.value,
    locked: isEnvKeyLocked(entry.key, routePortEnvVars),
    edited: false,
  }))
}

export function envRowsToPatchSet(rows: EnvRow[]): Record<string, string> {
  const set: Record<string, string> = {}
  for (const row of rows) {
    if (row.locked || !row.key.trim() || !row.edited || isMaskedEnvPlaceholder(row.value)) {
      continue
    }
    set[row.key] = row.value
  }
  return set
}
