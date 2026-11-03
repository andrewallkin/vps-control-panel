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

export function envKeysToPatchUnset(
  loadedKeys: string[],
  rows: EnvRow[],
  routePortEnvVars: string[],
): string[] {
  const currentKeys = new Set(rows.map((row) => row.key).filter((key) => key.trim() !== ''))
  const unset: string[] = []
  for (const key of loadedKeys) {
    if (currentKeys.has(key)) {
      continue
    }
    if (isEnvKeyLocked(key, routePortEnvVars)) {
      continue
    }
    unset.push(key)
  }
  return unset
}

/** Renamed rows whose value is still the masked placeholder, so saving would
 * delete the original key without recreating it under the new name. */
export function renamedRowsNeedingReveal(rows: EnvRow[]): EnvRow[] {
  return rows.filter(
    (row) =>
      row.renamedFrom !== undefined &&
      row.renamedFrom !== row.key &&
      row.key.trim() !== '' &&
      !row.locked &&
      isMaskedEnvPlaceholder(row.value),
  )
}

/** Replaces masked values of renamed rows with the revealed original values so
 * the patch recreates the renamed variable instead of dropping it. */
export function fillRenamedSetValues(
  set: Record<string, string>,
  rows: EnvRow[],
  revealed: Map<string, string>,
): { set: Record<string, string>; missing: string[] } {
  const nextSet = { ...set }
  const missing: string[] = []
  for (const row of rows) {
    const value = row.renamedFrom !== undefined ? revealed.get(row.renamedFrom) : undefined
    if (value === undefined) {
      missing.push(row.renamedFrom ?? row.key)
      continue
    }
    nextSet[row.key] = value
  }
  return { set: nextSet, missing }
}
