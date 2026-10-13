import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DockerDf } from '../../lib/dashboardTypes'
import { DockerDiskCard } from './DockerDiskCard'

vi.mock('../../lib/dashboardApi', () => ({
  pruneUnusedImages: vi.fn(),
  pruneBuildCache: vi.fn(),
}))

const dfFixture: DockerDf = {
  images: { size_bytes: 1, reclaimable_bytes: 0, count: 1 },
  containers: { size_bytes: 2, reclaimable_bytes: 0, count: 1 },
  volumes: { size_bytes: 3, reclaimable_bytes: 0, count: 0 },
  build_cache: { size_bytes: 4, reclaimable_bytes: 4, count: 1 },
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <DockerDiskCard df={dfFixture} dataUpdatedAt={Date.now()} isLoading={false} />
    </QueryClientProvider>,
  )
}

describe('DockerDiskCard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows build cache prune button and 24-hour confirmation', async () => {
    const user = userEvent.setup()
    renderCard()

    const button = screen.getByRole('button', { name: 'Prune build cache' })
    expect(button).toBeInTheDocument()

    await user.click(button)

    expect(
      screen.getByText(
        'This deletes unused Docker build cache older than 24 hours. Images and running containers are not affected.',
      ),
    ).toBeInTheDocument()
  })
})
