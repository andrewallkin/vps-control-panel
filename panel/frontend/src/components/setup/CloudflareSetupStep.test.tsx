import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudflareSetupStep } from './CloudflareSetupStep'

vi.mock('../../lib/domainsApi', () => ({
  fetchCloudflareZones: vi.fn(),
  postCloudflareToken: vi.fn(),
  updateServerSettings: vi.fn(),
}))

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  }
}

describe('CloudflareSetupStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps Continue disabled until the zone request finishes', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()

    const { rerender, queryClient } = renderWithClient(
      <CloudflareSetupStep
        configured
        zones={[]}
        zonesLoading
        acmeEmail="ops@example.com"
        onTokenSaved={() => undefined}
        onContinue={onContinue}
      />,
    )

    const continueButton = screen.getByRole('button', { name: /continue/i })
    expect(continueButton).toBeDisabled()

    await user.click(continueButton)
    expect(onContinue).not.toHaveBeenCalled()

    rerender(
      <QueryClientProvider client={queryClient}>
        <CloudflareSetupStep
          configured
          zones={[{ id: 'z1', name: 'example.com', status: 'active' }]}
          zonesLoading={false}
          acmeEmail="ops@example.com"
          onTokenSaved={() => undefined}
          onContinue={onContinue}
        />
      </QueryClientProvider>,
    )

    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /continue/i }))
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('shows a zone load error and then allows Continue', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()

    renderWithClient(
      <CloudflareSetupStep
        configured
        zones={[]}
        zonesLoading={false}
        zonesError="Could not load Cloudflare zones."
        acmeEmail="ops@example.com"
        onTokenSaved={() => undefined}
        onContinue={onContinue}
      />,
    )

    expect(screen.getByText(/could not load cloudflare zones/i)).toBeInTheDocument()
    const continueButton = screen.getByRole('button', { name: /continue/i })
    expect(continueButton).toBeEnabled()
    await user.click(continueButton)
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('requires a valid ACME email before Continue and persists it', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()
    const { updateServerSettings } = await import('../../lib/domainsApi')
    vi.mocked(updateServerSettings).mockResolvedValue({
      public_ipv4: '',
      acme_email: 'ops@example.com',
    })

    renderWithClient(
      <CloudflareSetupStep
        configured
        zones={[{ id: 'z1', name: 'example.com', status: 'active' }]}
        onTokenSaved={() => undefined}
        onContinue={onContinue}
      />,
    )

    const emailInput = screen.getByLabelText(/acme email/i)
    expect(emailInput).toBeInTheDocument()

    // No email yet: Continue disabled
    const continueButton = screen.getByRole('button', { name: /continue/i })
    expect(continueButton).toBeDisabled()

    // Invalid email: still disabled
    await user.type(emailInput, 'not-an-email')
    expect(continueButton).toBeDisabled()

    // Valid email: enabled, and continue persists it before advancing
    await user.clear(emailInput)
    await user.type(emailInput, 'ops@example.com')
    expect(continueButton).toBeEnabled()
    await user.click(continueButton)
    expect(updateServerSettings).toHaveBeenCalledWith({ acme_email: 'ops@example.com' })
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('continues without retyping when an ACME email is already saved', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()
    const { updateServerSettings } = await import('../../lib/domainsApi')

    renderWithClient(
      <CloudflareSetupStep
        configured
        zones={[{ id: 'z1', name: 'example.com', status: 'active' }]}
        acmeEmail="ops@example.com"
        onTokenSaved={() => undefined}
        onContinue={onContinue}
      />,
    )

    const continueButton = screen.getByRole('button', { name: /continue/i })
    expect(continueButton).toBeEnabled()
    await user.click(continueButton)
    expect(updateServerSettings).not.toHaveBeenCalled()
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('tells a new user to add Zone WAF Edit', () => {
    renderWithClient(
      <CloudflareSetupStep
        configured={false}
        zones={[]}
        acmeEmail="ops@example.com"
        onTokenSaved={() => undefined}
        onContinue={() => undefined}
      />,
    )

    expect(screen.getByText(/Zone WAF Edit/)).toBeInTheDocument()
    expect(screen.getByText(/Zone:Read, DNS:Edit, and Zone WAF Edit/)).toBeInTheDocument()
  })
})
