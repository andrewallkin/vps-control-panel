import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RestoreResultSummary } from './RestoreResultSummary'
import type { JobEndPayload } from '../../lib/setupApi'

function endPayload(status: string, error?: string): JobEndPayload {
  return {
    job_id: 'job-1',
    status,
    error: error ?? null,
    result: { databases: [], roles: [], error_count: 0, errors: [] },
  } as unknown as JobEndPayload
}

describe('RestoreResultSummary', () => {
  it('offers Continue after success so the wizard can advance', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()
    render(
      <RestoreResultSummary end={endPayload('succeeded')} onContinue={onContinue} />,
    )
    await user.click(screen.getByRole('button', { name: /continue/i }))
    expect(onContinue).toHaveBeenCalledOnce()
  })

  it('offers Try again after failure so the operator is not stuck', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <RestoreResultSummary
        end={endPayload('failed', 'restore failed')}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByText(/restore failed/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
