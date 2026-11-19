import { describe, expect, it } from 'vitest'
import { validateRoutePath } from './routeValidation'

describe('validateRoutePath', () => {
  it.each([
    '/',
    '/api/',
    '/.well-known',
    '/.well-known/oauth-authorization-server',
  ])('accepts %s', (path) => {
    expect(validateRoutePath(path)).toBe(true)
  })

  it.each(['', 'api', '/a/../b', '/..', '/foo..bar'])('rejects %s', (path) => {
    expect(validateRoutePath(path)).toBe(false)
  })
})