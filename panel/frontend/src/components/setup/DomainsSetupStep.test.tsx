import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DomainsSetupStep } from './DomainsSetupStep'

vi.mock('../../lib/domainsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/domainsApi')>()),
  fetchCloudflareZones: vi.fn(),
  fetchDomains: vi.fn(),
  registerDomain: vi.fn(),
  reissueDomain: vi.fn(),
}))

vi.mock('./LogViewer', () => ({
  LogViewer: ({ jobId }: { jobId: string }) => (
    <div data-testid="log-viewer">{jobId}</div>
  ),
}))

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('DomainsSetupStep', () => {
  it('offers Reissue when a registered domain has no valid certificate', async () => {
    const user = userEvent.setup()
    const { fetchDomains, reissueDomain } = await import('../../lib/domainsApi')
    vi.mocked(fetchDomains).mockResolvedValue([
      {
        name: 'example.com',
        zone_id: 'zone-1',
        cert_status: 'missing',
        cert_expires_at: null,
        ssl_mode: 'strict',
        ssl_mode_error: null,
        warning: null,
      },
    ])
    vi.mocked(reissueDomain).mockResolvedValue({ job_id: 'job-reissue-1' })

    renderWithClient(<DomainsSetupStep onCertReady={() => undefined} />)

    await screen.findByRole('button', { name: /reissue certificate/i })
    await user.click(screen.getByRole('button', { name: /reissue certificate/i }))
    await waitFor(() =>
      expect(reissueDomain).toHaveBeenCalledWith('example.com', expect.anything()),
    )
    expect(await screen.findByTestId('log-viewer')).toHaveTextContent('job-reissue-1')
  })

  it('shows issuance error and keeps the domain registered when issuance fails', async () => {
    const user = userEvent.setup()
    const { fetchDomains, fetchCloudflareZones, registerDomain } = await import(
      '../../lib/domainsApi'
    )
    vi.mocked(fetchDomains).mockResolvedValue([])
    vi.mocked(fetchCloudflareZones).mockResolvedValue({
      configured: true,
      zones: [{ id: 'zone-1', name: 'example.com', status: 'active' }],
    })
    vi.mocked(registerDomain).mockResolvedValue({
      job_id: null,
      issue_error: 'acme_email is not configured',
    })

    renderWithClient(<DomainsSetupStep onCertReady={() => undefined} />)
    await user.click(screen.getByRole('button', { name: /add domain/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /add domain/i }))

    expect(
      await screen.findByText(/certificate issuance failed/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/acme_email is not configured/)).toBeInTheDocument()
    expect(registerDomain).toHaveBeenCalledWith(
      { name: 'example.com', zone_id: 'zone-1' },
      expect.anything(),
    )
  })
})
