import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
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
  it('shows the panel hostname under the matching zone row', async () => {
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
        warning: null,
      },
    ])
    vi.mocked(fetchPanelHostname).mockResolvedValue({ panel_hostname: 'panel.example.com' })

    renderWithClient(<DomainsPage />)

    expect(await screen.findByText('panel.example.com')).toBeInTheDocument()
    expect(screen.getByText(/panel hostname/i)).toBeInTheDocument()
  })
})
