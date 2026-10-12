import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditPage } from './AuditPage'
import { renderWithProviders } from '../test/renderWithProviders'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const auditEntry = {
  time: '2026-01-15T12:00:00+00:00',
  source: 'agent' as const,
  operation: 'container.restart',
  params: { name: 'web' },
  ok: true,
  duration_ms: 42,
}

describe('AuditPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/api/audit')) {
          return Promise.resolve(
            jsonResponse({ entries: [auditEntry], next_cursor: null }),
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

  it('shows audit entry source and keeps params collapsed', async () => {
    renderWithProviders(<AuditPage />)

    await waitFor(() => {
      expect(screen.getByText('container.restart')).toBeInTheDocument()
    })

    expect(screen.getByText('agent')).toBeInTheDocument()

    const row = screen.getByText('container.restart').closest('tr')
    expect(row).toBeTruthy()
    const details = within(row as HTMLElement).getByText('Params').closest('details')
    expect(details).toBeInTheDocument()
    expect(details).not.toHaveAttribute('open')
  })
})
