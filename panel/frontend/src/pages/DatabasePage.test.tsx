import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabasePage } from './DatabasePage'
import { renderWithProviders } from '../test/renderWithProviders'

vi.mock('../components/StepUpDialog', () => ({
  StepUpDialog: ({
    open,
    onVerified,
  }: {
    open: boolean
    onVerified: () => void
  }) => (open ? <button type="button" onClick={onVerified}>mock verify</button> : null),
}))

vi.mock('../lib/chunkedUpload', async () => {
  const actual = await vi.importActual<typeof import('../lib/chunkedUpload')>('../lib/chunkedUpload')
  return {
    ...actual,
    uploadDumpFile: vi.fn(async () => ({
      uploadId: 'up-1',
      info: {
        id: 'up-1',
        filename: 'cluster.sql.gz',
        size: 12,
        kind: 'pg_dumpall',
        header_ok: true,
        databases: ['budgethq'],
        roles: ['budgethq_user'],
      },
    })),
  }
})

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

  it('asks to overwrite when a restore hits a nonempty cluster', async () => {
    const user = userEvent.setup()
    const restoreBodies: unknown[] = []
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener() {}
        close() {}
      },
    )
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/setup/restore')) {
        restoreBodies.push(JSON.parse(String(init?.body)))
        if (restoreBodies.length === 1) {
          return Promise.resolve(
            jsonResponse(
              {
                detail: {
                  code: 'cluster_not_empty',
                  databases: ['budgethq'],
                  roles: ['budgethq_user'],
                },
              },
              409,
            ),
          )
        }
        return Promise.resolve(jsonResponse({ job_id: 'job-restore-1' }))
      }
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
    })

    renderWithProviders(<DatabasePage />)

    await waitFor(() => {
      expect(screen.getByText('orphan_db')).toBeInTheDocument()
    })

    const file = new File(['pg-dump'], 'cluster.sql.gz', { type: 'application/gzip' })
    await user.upload(screen.getByLabelText(/cluster dump file/i), file)
    await user.click(screen.getByRole('button', { name: /mock verify/i }))

    await user.click(await screen.findByRole('button', { name: /restore from dump/i }))
    await user.type(screen.getByLabelText(/confirmation/i), 'RESTORE')
    await user.click(screen.getByRole('button', { name: /restore cluster/i }))
    await user.click(screen.getByRole('button', { name: /mock verify/i }))

    expect(await screen.findByText(/would be replaced/i)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /overwrite existing data/i })).toBeInTheDocument()
    expect(screen.queryByText('Request failed.')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText(/overwrite existing data/i))
    await user.type(screen.getByLabelText(/confirmation/i), 'RESTORE')
    await user.click(screen.getByRole('button', { name: /restore cluster/i }))
    await user.click(screen.getByRole('button', { name: /mock verify/i }))

    await waitFor(() => {
      expect(restoreBodies).toHaveLength(2)
    })
    expect(restoreBodies[1]).toMatchObject({ upload_id: 'up-1', overwrite: true })
  })
})
