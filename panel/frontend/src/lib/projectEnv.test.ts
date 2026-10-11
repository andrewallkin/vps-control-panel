import { describe, expect, it } from 'vitest'
import type { EnvRow } from './envEditorUtils'
import { envKeysToPatchUnset, envRowsToPatchSet } from './projectEnv'

describe('envRowsToPatchSet', () => {
  it('omits unedited masked rows and includes user-edited values', () => {
    const rows: EnvRow[] = [
      { key: 'SECRET', value: '••••gh', locked: false, edited: false },
      { key: 'OTHER', value: 'new-secret', locked: false, edited: true },
    ]

    expect(envRowsToPatchSet(rows)).toEqual({ OTHER: 'new-secret' })
  })
})

describe('envKeysToPatchUnset', () => {
  it('unsets keys removed from the editor but not keys still present', () => {
    const loadedKeys = ['FOO', 'BAR']
    const rows: EnvRow[] = [{ key: 'BAR', value: 'b', locked: false, edited: false }]

    expect(envKeysToPatchUnset(loadedKeys, rows, [])).toEqual(['FOO'])
  })
})
