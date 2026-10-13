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

    expect(screen.getAllByText('example.com')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /reissue/i })).toBeInTheDocument()

    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(4)

    const domain = within(rows[1]!)
    expect(domain.getByText('example.com')).toBeInTheDocument()
    expect(domain.getByText('Domain')).toBeInTheDocument()
    expect(domain.getByText('Apex')).toBeInTheDocument()

    const panel = within(rows[2]!)
    expect(panel.getByText('panel.example.com')).toBeInTheDocument()
    expect(panel.getByText('Subdomain')).toBeInTheDocument()
    expect(panel.getByText('Panel')).toBeInTheDocument()

    const project = within(rows[3]!)
    expect(project.getByText('app.example.com')).toBeInTheDocument()
    expect(project.getByText('Subdomain')).toBeInTheDocument()
    expect(project.getByText('Blog')).toBeInTheDocument()
  })
})
