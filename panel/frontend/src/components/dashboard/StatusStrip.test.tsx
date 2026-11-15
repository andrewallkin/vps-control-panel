import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardSummary } from '../../lib/dashboardTypes'
import { StatusStrip } from './StatusStrip'

const baseSummary: DashboardSummary = {
  backup: {
    last_run: null,
    overdue: false,
    failed: false,
  },
  warnings: [],
  projects: { total: 1, up: 1, unhealthy: 0 },
  nearest_cert_expiry: null,
}

function renderStrip(summary: DashboardSummary) {
  return render(
    <MemoryRouter>
      <StatusStrip summary={summary} />
    </MemoryRouter>,
  )
}

describe('StatusStrip', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('formats backup last_run from finished_at', () => {
    const iso = new Date(2026, 9, 13, 15, 52, 2).toISOString()

    renderStrip({
      ...baseSummary,
      backup: {
        last_run: { success: true, finished_at: iso },
        overdue: false,
        failed: false,
      },
    })

    expect(screen.getByText('13 October 2026, 15:52:02')).toBeInTheDocument()
  })

  it('shows Never when last_run is null', () => {
    renderStrip({
      ...baseSummary,
      backup: { last_run: null, overdue: false, failed: false },
    })
    expect(screen.getByText('Never')).toBeInTheDocument()
  })

  it('shows Not configured when backup is null', () => {
    renderStrip({
      ...baseSummary,
      backup: null,
    })
    expect(screen.getByText('Not configured')).toBeInTheDocument()
  })
})
