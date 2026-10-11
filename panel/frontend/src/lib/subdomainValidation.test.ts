import { describe, expect, it } from 'vitest'
import { buildFqdn, validateSubdomain } from './subdomainValidation'

describe('validateSubdomain', () => {
  it('accepts empty string as apex', () => {
    expect(validateSubdomain('')).toEqual({ ok: true, normalized: '' })
    expect(validateSubdomain('   ')).toEqual({ ok: true, normalized: '' })
  })

  it('accepts a single valid label', () => {
    expect(validateSubdomain('panel')).toEqual({ ok: true, normalized: 'panel' })
    expect(validateSubdomain('My-App')).toEqual({ ok: true, normalized: 'my-app' })
  })

  it('rejects a second DNS label', () => {
    const result = validateSubdomain('app.staging')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/single DNS label/i)
    }
  })

  it('rejects invalid characters and edge labels', () => {
    expect(validateSubdomain('-bad').ok).toBe(false)
    expect(validateSubdomain('bad-').ok).toBe(false)
    expect(validateSubdomain('_x').ok).toBe(false)
  })
})

describe('buildFqdn', () => {
  it('builds apex and subdomain FQDNs', () => {
    expect(buildFqdn('example.com', '')).toBe('example.com')
    expect(buildFqdn('example.com', 'panel')).toBe('panel.example.com')
  })
})
