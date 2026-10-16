import { describe, expect, it } from 'vitest'
import {
  parsePortDraft,
  validatePortDrafts,
  type PortDraft,
  type UsedPortRow,
} from './portMappings'

const used: UsedPortRow[] = [
  { port: 8000, owner: 'spliteasy', env_var: 'BACKEND_PORT' },
  { port: 5432, owner: null, env_var: null },
]

function draft(env_var: string, host_port: string, defaultPort: number | null = null): PortDraft {
  return { env_var, default: defaultPort, host_port }
}

describe('parsePortDraft', () => {
  it('parses an integer string', () => {
    expect(parsePortDraft('8001')).toBe(8001)
  })

  it('rejects non-integers and empty strings', () => {
    expect(parsePortDraft('')).toBeNull()
    expect(parsePortDraft('abc')).toBeNull()
    expect(parsePortDraft('80.5')).toBeNull()
    expect(parsePortDraft('0')).toBeNull()
    expect(parsePortDraft('70000')).toBeNull()
  })
})

describe('validatePortDrafts', () => {
  it('accepts free ports', () => {
    const result = validatePortDrafts([draft('APP_PORT', '8001')], used, 'myapp')
    expect(result.ok).toBe(true)
  })

  it('rejects out of range and malformed values', () => {
    expect(validatePortDrafts([draft('APP_PORT', '')], used, 'myapp').ok).toBe(false)
    expect(validatePortDrafts([draft('APP_PORT', '0')], used, 'myapp').ok).toBe(false)
    expect(validatePortDrafts([draft('APP_PORT', '70000')], used, 'myapp').ok).toBe(false)
  })

  it('flags a port owned by another project', () => {
    const result = validatePortDrafts([draft('APP_PORT', '8000')], used, 'myapp')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('spliteasy')
  })

  it('flags a system listening port', () => {
    const result = validatePortDrafts([draft('APP_PORT', '5432')], used, 'myapp')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('in use')
  })

  it('allows keeping the port already allocated to the same project var', () => {
    const mine: UsedPortRow[] = [{ port: 10001, owner: 'myapp', env_var: 'APP_PORT' }]
    const result = validatePortDrafts([draft('APP_PORT', '10001')], mine, 'myapp')
    expect(result.ok).toBe(true)
  })

  it('rejects two vars sharing one port', () => {
    const result = validatePortDrafts(
      [draft('A_PORT', '8001'), draft('B_PORT', '8001')],
      used,
      'myapp',
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('A_PORT')
    expect(result.error).toContain('B_PORT')
  })
})

describe('adopting own container bindings', () => {
  it('allows a port bound by the same project container even without an allocation row', () => {
    const containerOnly: UsedPortRow[] = [{ port: 8000, owner: 'myapp', env_var: null }]
    const result = validatePortDrafts([draft('BACKEND_PORT', '8000')], containerOnly, 'myapp')
    expect(result.ok).toBe(true)
  })

  it('still blocks a container port owned by another project', () => {
    const foreign: UsedPortRow[] = [{ port: 8000, owner: 'spliteasy', env_var: null }]
    const result = validatePortDrafts([draft('BACKEND_PORT', '8000')], foreign, 'myapp')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('spliteasy')
  })
})
