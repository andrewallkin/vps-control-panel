import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './SettingsPage'
import { renderWithProviders } from '../test/renderWithProviders'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/api/cloudflare/zones')) {
          return Promise.resolve(jsonResponse({ configured: false, zones: [] }))
        }
        if (url.includes('/api/server-settings')) {
          return Promise.resolve(jsonResponse({ acme_email: '', public_ipv4: '' }))
        }
        if (url.includes('/api/settings/registry')) {
          return Promise.resolve(jsonResponse({ configured: false }))
        }
        if (url.includes('/api/account/sessions')) {
          return Promise.resolve(jsonResponse([]))
        }
        if (url.includes('/api/health/agent')) {
          return Promise.resolve(
            jsonResponse({ status: 'ok', version: '0.2.0-agent' }),
          )
        }
        if (url.endsWith('/api/health') || url.includes('/api/health?')) {
          return Promise.resolve(
            jsonResponse({ status: 'ok', version: '0.1.0-panel' }),
          )
        }
        if (url.includes('/api/auth/me')) {
          return Promise.resolve(
            jsonResponse({
              username: 'admin',
              setup_complete: true,
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

  it('About section shows panel and agent version strings', async () => {
    renderWithProviders(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('0.1.0-panel')).toBeInTheDocument()
    })
    expect(screen.getByText('0.2.0-agent')).toBeInTheDocument()
  })

  it('password form includes current password and authenticator code fields', async () => {
    renderWithProviders(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/current password/i)).toBeInTheDocument()
    })
    expect(screen.getByLabelText(/authenticator code/i)).toBeInTheDocument()
  })
})
