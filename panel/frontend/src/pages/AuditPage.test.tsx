import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

    const page = screen.getByRole('heading', { name: 'Audit' }).parentElement?.parentElement
    expect(page).toHaveClass('w-full')
    expect(page).not.toHaveClass('max-w-6xl')
  })

  it('requests failed results and clears the filters', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AuditPage />)

    await waitFor(() => {
      expect(screen.getByText('container.restart')).toBeInTheDocument()
    })

    await user.selectOptions(screen.getByLabelText('Result'), 'failed')

    await waitFor(() => {
      const urls = vi.mocked(fetch).mock.calls.map(([input]) => String(input))
      expect(urls.some((url) => url.includes('ok=false'))).toBe(true)
    })

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() => {
      expect(screen.getByLabelText('Result')).toHaveValue('all')
    })
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument()
  })
})
