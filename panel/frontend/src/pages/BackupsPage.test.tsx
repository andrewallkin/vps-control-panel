import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackupsPage } from './BackupsPage'
import { renderWithProviders } from '../test/renderWithProviders'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const configuredSettings = {
  bucket: 'my-backups',
  schedule_hours: '2,14',
  schedule_minute: 15,
  timezone: 'UTC',
  retention_days: 14,
  credentials_configured: true,
  client_email: 'backup-sa@project.iam.gserviceaccount.com',
  archive_passphrase_set: true,
}

const overdueStatus = {
  last_run: {
    finished_at: '2025-06-10T12:00:00+00:00',
    success: true,
    object: 'backups/dump.sql.gz',
    size_bytes: 4096,
  },
  trigger_pending: false,
  container: 'vpscp-backup',
  next_run: '2025-06-15T12:30:00+00:00',
  overdue: true,
}

describe('BackupsPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/api/backups/settings')) {
          return Promise.resolve(jsonResponse(configuredSettings))
        }
        if (url.includes('/api/backups/status')) {
          return Promise.resolve(jsonResponse(overdueStatus))
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

  it('shows client_email when credentials are configured and not the service account key', async () => {
    renderWithProviders(<BackupsPage />)

    await waitFor(() => {
      expect(screen.getByText('backup-sa@project.iam.gserviceaccount.com')).toBeInTheDocument()
    })

    expect(screen.queryByLabelText(/service account json/i)).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue(/private_key/i)).not.toBeInTheDocument()
  })

  it('labels schedule hours with the configured timezone, not UTC', async () => {
    renderWithProviders(<BackupsPage />)

    await waitFor(() => {
      expect(screen.getByText('Schedule hours (UTC time)')).toBeInTheDocument()
    })
    expect(screen.queryByText(/UTC clock/i)).not.toBeInTheDocument()
  })

  it('renders an overdue badge when backup status is overdue', async () => {
    renderWithProviders(<BackupsPage />)

    await waitFor(() => {
      expect(screen.getByText('Overdue')).toBeInTheDocument()
    })
  })
})
