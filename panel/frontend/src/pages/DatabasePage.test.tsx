import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabasePage } from './DatabasePage'
import { renderWithProviders } from '../test/renderWithProviders'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const databases = [
  {
    name: 'orphan_db',
    owner: 'orphan_user',
    size_bytes: 8192,
    attached_slug: null,
  },
  {
    name: 'app_db',
    owner: 'app_user',
    size_bytes: 16384,
    attached_slug: 'myapp',
  },
]

describe('DatabasePage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/api/database/databases')) {
          return Promise.resolve(jsonResponse(databases))
        }
        if (url.includes('/api/projects') && !url.includes('/api/projects/')) {
          return Promise.resolve(jsonResponse([]))
        }
        if (url.includes('/api/database/dumps/')) {
          return Promise.resolve(jsonResponse([]))
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

  it('shows Unattached for a database without a project', async () => {
    renderWithProviders(<DatabasePage />)

    await waitFor(() => {
      expect(screen.getByText('orphan_db')).toBeInTheDocument()
    })

    expect(screen.getByText('Unattached')).toBeInTheDocument()
  })

  it('keeps drop disabled until the typed name matches', async () => {
    const user = userEvent.setup()
    renderWithProviders(<DatabasePage />)

    await waitFor(() => {
      expect(screen.getByText('orphan_db')).toBeInTheDocument()
    })

    await user.click(screen.getAllByRole('button', { name: /^drop$/i })[0]!)

    const dropButton = screen.getByRole('button', { name: /^drop database$/i })
    expect(dropButton).toBeDisabled()

    await user.type(screen.getByLabelText(/type database name to confirm/i), 'wrong')
    expect(dropButton).toBeDisabled()

    await user.clear(screen.getByLabelText(/type database name to confirm/i))
    await user.type(screen.getByLabelText(/type database name to confirm/i), 'orphan_db')
    expect(dropButton).toBeEnabled()
  })

  it('restore warning mentions the safety dump', () => {
    renderWithProviders(<DatabasePage />)

    expect(screen.getByRole('heading', { name: 'Cluster restore' })).toBeInTheDocument()
    expect(screen.getByText(/safety dump/i)).toBeInTheDocument()
  })
})
