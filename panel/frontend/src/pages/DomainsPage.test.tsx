import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DomainsPage } from './DomainsPage'

vi.mock('../lib/domainsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/domainsApi')>()),
  fetchCloudflareZones: vi.fn(),
  fetchDomains: vi.fn(),
  fetchPanelHostname: vi.fn(),
  registerDomain: vi.fn(),
  reissueDomain: vi.fn(),
  deleteDomain: vi.fn(),
}))

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DomainsPage panel hostname', () => {
  it('lists zone, panel, and project hostnames with labels', async () => {
    const { fetchCloudflareZones, fetchDomains, fetchPanelHostname } = await import(
      '../lib/domainsApi'
    )
    vi.mocked(fetchCloudflareZones).mockResolvedValue({
      configured: true,
      zones: [{ id: 'zone-1', name: 'example.com', status: 'active' }],
    })
    vi.mocked(fetchDomains).mockResolvedValue([
      {
        name: 'example.com',
        zone_id: 'zone-1',
        cert_status: 'valid',
        cert_expires_at: '2027-01-01T00:00:00.000Z',
        ssl_mode: 'strict',
        ssl_mode_error: null,
        warning: null,
        hostnames: [
          {
            fqdn: 'example.com',
            kind: 'zone',
            project_slug: null,
            project_name: null,
          },
          {
            fqdn: 'panel.example.com',
            kind: 'panel',
            project_slug: null,
            project_name: null,
          },
          {
            fqdn: 'app.example.com',
            kind: 'primary',
            project_slug: 'blog',
            project_name: 'Blog',
          },
        ],
      },
    ])
    vi.mocked(fetchPanelHostname).mockResolvedValue({ panel_hostname: 'panel.example.com' })

    renderWithClient(<DomainsPage />)

    await waitFor(() => {
      expect(screen.queryByText('Loading domains…')).not.toBeInTheDocument()
    })

    const table = screen.getByRole('table')
    const tbody = table.querySelector('tbody')
    expect(tbody).not.toBeNull()
    const row = tbody!.querySelector('tr')
    expect(row).not.toBeNull()
    const namesCell = row!.querySelector('td')
    expect(namesCell).not.toBeNull()
    const names = within(namesCell as HTMLElement)

    expect(names.getByText('example.com')).toBeInTheDocument()
    expect(names.getByText('panel.example.com')).toBeInTheDocument()
    expect(names.getByText('app.example.com')).toBeInTheDocument()
    expect(names.getByText('Zone')).toBeInTheDocument()
    expect(names.getByText('Panel')).toBeInTheDocument()
    expect(names.getByText('Blog')).toBeInTheDocument()
  })
})
