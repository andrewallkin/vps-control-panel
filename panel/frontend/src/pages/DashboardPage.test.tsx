import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'
import { renderWithProviders } from '../test/renderWithProviders'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const emptySummary = {
  backup: null,
  warnings: [],
  projects: { total: 0, up: 0, unhealthy: 0 },
  nearest_cert_expiry: null,
}

describe('DashboardPage', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    })

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/api/metrics/current')) {
          return Promise.resolve(
            jsonResponse({
              ts: '2026-01-15T12:00:00+00:00',
              cpu_percent: 0,
              cpu_count: 1,
              load1: 0,
              load5: 0,
              load15: 0,
              mem_total: 1,
              mem_available: 1,
              mem_used: 0,
              mem_percent: 0,
              swap_total: 0,
              swap_used: 0,
              uptime_seconds: 0,
              disks: [],
            }),
          )
        }
        if (url.includes('/api/metrics/history')) {
          return Promise.resolve(jsonResponse([]))
        }
        if (url.includes('/api/metrics/containers')) {
          return Promise.resolve(jsonResponse([]))
        }
        if (url.includes('/api/docker/df')) {
          return Promise.resolve(
            jsonResponse({
              images: { size_bytes: 0, reclaimable_bytes: 0, count: 0 },
              containers: { size_bytes: 0, reclaimable_bytes: 0, count: 0 },
              volumes: { size_bytes: 0, reclaimable_bytes: 0, count: 0 },
              build_cache: { size_bytes: 0, reclaimable_bytes: 0, count: 0 },
            }),
          )
        }
        if (url.includes('/api/dashboard/summary')) {
          return Promise.resolve(jsonResponse(emptySummary))
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

  it('uses full-width page layout', async () => {
    renderWithProviders(<DashboardPage />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    })

    const page = screen.getByRole('heading', { name: 'Dashboard' }).parentElement
      ?.parentElement
    expect(page).toHaveClass('w-full')
    expect(page).not.toHaveClass('max-w-6xl')
  })
})
