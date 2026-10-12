import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OptionalSetupStep } from './OptionalSetupStep'
import { renderWithProviders } from '../../test/renderWithProviders'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('OptionalSetupStep', () => {
  const onSkipped = vi.fn()

  beforeEach(() => {
    onSkipped.mockReset()
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/api/settings/registry')) {
          return Promise.resolve(jsonResponse({ configured: false }))
        }
        if (url.includes('/api/backups/settings')) {
          return Promise.resolve(
            jsonResponse({
              bucket: '',
              schedule_hours: '3',
              schedule_minute: 0,
              timezone: 'UTC',
              retention_days: 30,
              credentials_configured: false,
              client_email: null,
              archive_passphrase_set: false,
            }),
          )
        }
        if (url.includes('/api/setup/complete') && init?.method === 'POST') {
          onSkipped()
          return Promise.resolve(jsonResponse({ steps: [], completed: true }))
        }
        if (url.includes('/api/auth/me')) {
          return Promise.resolve(
            jsonResponse({
              username: 'admin',
              setup_complete: false,
              csrf_token: 'csrf',
              stepped_up_until: null,
            }),
          )
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('can skip without filling Docker Hub or backup forms', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <OptionalSetupStep onContinueToFinish={() => {}} onSkipped={() => {}} />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^skip$/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /^skip$/i }))

    await waitFor(() => {
      expect(onSkipped).toHaveBeenCalled()
    })
  })

  it('per-card Skip section collapses the card without completing setup', async () => {
    // onSkipped (the outer spy) fires whenever POST /api/setup/complete happens;
    // a per-card skip must not hit that endpoint at all.
    const user = userEvent.setup()
    renderWithProviders(
      <OptionalSetupStep onContinueToFinish={() => {}} onSkipped={() => {}} />,
    )
    const skips = screen.getAllByRole('button', { name: /skip section/i })
    await user.click(skips[0])
    await user.click(skips[1])
    expect(onSkipped).not.toHaveBeenCalled()
  })
})
