import { describe, expect, it } from 'vitest'
import type { EnvRow } from './envEditorUtils'
import { envRowsToPatchSet } from './projectEnv'

describe('envRowsToPatchSet', () => {
  it('omits unedited masked rows and includes user-edited values', () => {
    const rows: EnvRow[] = [
      { key: 'SECRET', value: '••••gh', locked: false, edited: false },
      { key: 'OTHER', value: 'new-secret', locked: false, edited: true },
    ]

    expect(envRowsToPatchSet(rows)).toEqual({ OTHER: 'new-secret' })
  })
})
