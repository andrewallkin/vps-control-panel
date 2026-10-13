import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PanelHostnameSetupStep } from './PanelHostnameSetupStep'
import { resolveActiveStep } from '../../lib/setupWizard'
import type { SetupStep } from '../../lib/setupApi'

vi.mock('../../lib/domainsApi', () => ({
  fetchDomains: vi.fn(),
  setPanelHostname: vi.fn(),
}))

import { fetchDomains, setPanelHostname } from '../../lib/domainsApi'

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const setupStepsWithPanelHostnameDone: SetupStep[] = [
  { id: 'account', status: 'done' },
  { id: 'database', status: 'empty' },
  { id: 'cloudflare', status: 'done' },
  { id: 'domains', status: 'done' },
  { id: 'panel_hostname', status: 'done' },
]

describe('PanelHostnameSetupStep', () => {
  it('shows the public https URL and Cloudflare Access recommendation after save', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchDomains).mockResolvedValue([
      {
        name: 'example.com',
        zone_id: 'zone-1',
        cert_status: 'valid',
        cert_expires_at: null,
        ssl_mode: null,
        ssl_mode_error: null,
        warning: null,
      },
    ])
    vi.mocked(setPanelHostname).mockResolvedValue({ panel_hostname: 'panel.example.com' })

    renderWithClient(<PanelHostnameSetupStep onSaved={() => undefined} onContinue={() => undefined} />)

    await user.click(screen.getByRole('button', { name: /save hostname/i }))

    await waitFor(() => {
      expect(screen.getByText('https://panel.example.com')).toBeInTheDocument()
    })
    expect(
      screen.getByText(/add cloudflare access on this hostname/i),
    ).toBeInTheDocument()
  })

  it('stays on panel hostname in the wizard when the step is done but not acknowledged', () => {
    expect(
      resolveActiveStep(setupStepsWithPanelHostnameDone, true, null, false, null, {
        cloudflareAcknowledged: true,
        panelHostnameAcknowledged: false,
      }),
    ).toBe('panel_hostname')
  })
})
