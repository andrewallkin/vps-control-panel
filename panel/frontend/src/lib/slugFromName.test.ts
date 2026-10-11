import { describe, expect, it } from 'vitest'
import { slugFromName } from './slugFromName'

describe('slugFromName', () => {
  it('derives a slug from the display name', () => {
    expect(slugFromName('Budget HQ')).toEqual({ ok: true, slug: 'budget-hq' })
  })

  it('rejects reserved slugs', () => {
    const result = slugFromName('panel')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('reserved slug')
    }
  })
})
