import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './api'

describe('apiFetch', () => {
  const assign = vi.fn()

  beforeEach(() => {
    assign.mockReset()
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ detail: 'invalid_credentials' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      ),
    )
    vi.stubGlobal('location', { pathname: '/settings', assign })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not redirect to login on 401 from TOTP confirm', async () => {
    await apiFetch('/api/account/totp/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '000000' }),
    })

    expect(assign).not.toHaveBeenCalled()
  })
})
