import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CloudflareSetupStep } from './CloudflareSetupStep'

vi.mock('../../lib/domainsApi', () => ({
  fetchCloudflareZones: vi.fn(),
  postCloudflareToken: vi.fn(),
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
  it('keeps Continue disabled until the zone request finishes', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()

    const { rerender, queryClient } = renderWithClient(
      <CloudflareSetupStep
        configured
        zones={[]}
        zonesLoading
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
})
