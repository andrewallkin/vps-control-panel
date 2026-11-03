import { describe, expect, it } from 'vitest'
import type { EnvRow } from './envEditorUtils'
import {
  envKeysToPatchUnset,
  envRowsToPatchSet,
  fillRenamedSetValues,
  renamedRowsNeedingReveal,
} from './projectEnv'

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

describe('renamedRowsNeedingReveal', () => {
  it('returns renamed rows whose value is still the masked placeholder', () => {
    const rows: EnvRow[] = [
      { key: 'NEW', value: '••••gh', locked: false, edited: true, renamedFrom: 'OLD' },
      { key: 'TYPED', value: 'fresh-value', locked: false, edited: true, renamedFrom: 'OTHER' },
      { key: 'STILL', value: '••••on', locked: false, edited: false },
    ]

    expect(renamedRowsNeedingReveal(rows)).toEqual([
      { key: 'NEW', value: '••••gh', locked: false, edited: true, renamedFrom: 'OLD' },
    ])
  })

  it('ignores a rename back onto the original key and locked or empty keys', () => {
    const rows: EnvRow[] = [
      { key: 'OLD', value: '••••gh', locked: false, edited: true, renamedFrom: 'OLD' },
      { key: 'NEW', value: '••••gh', locked: true, edited: true, renamedFrom: 'OLD' },
      { key: '', value: '••••gh', locked: false, edited: true, renamedFrom: 'OLD' },
    ]

    expect(renamedRowsNeedingReveal(rows)).toEqual([])
  })
})

describe('fillRenamedSetValues', () => {
  it('replaces masked values of renamed rows with the revealed original values', () => {
    const rows: EnvRow[] = [
      { key: 'NEW', value: '••••gh', locked: false, edited: true, renamedFrom: 'OLD' },
    ]
    const revealed = new Map([['OLD', 'real-secret']])

    expect(fillRenamedSetValues({}, rows, revealed)).toEqual({ set: { NEW: 'real-secret' }, missing: [] })
  })

  it('keeps the set payload and reports missing keys when the original key is gone', () => {
    const rows: EnvRow[] = [
      { key: 'NEW', value: '••••gh', locked: false, edited: true, renamedFrom: 'OLD' },
    ]
    const revealed = new Map<string, string>()

    expect(fillRenamedSetValues({ KEEP: 'x' }, rows, revealed)).toEqual({
      set: { KEEP: 'x' },
      missing: ['OLD'],
    })
  })
})
