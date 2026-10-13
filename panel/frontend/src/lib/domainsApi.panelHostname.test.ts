import { describe, expect, it } from 'vitest'
import { panelHostnameUsesDomain } from './domainsApi'

describe('panelHostnameUsesDomain', () => {
  it('matches the zone apex', () => {
    expect(panelHostnameUsesDomain('example.com', 'example.com')).toBe(true)
  })

  it('matches a single label under the zone', () => {
    expect(panelHostnameUsesDomain('panel.example.com', 'example.com')).toBe(true)
  })

  it('does not match nested subdomains', () => {
    expect(panelHostnameUsesDomain('app.panel.example.com', 'example.com')).toBe(false)
  })

  it('does not match a different zone', () => {
    expect(panelHostnameUsesDomain('panel.other.com', 'example.com')).toBe(false)
  })
})
