import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DeployHistory } from './DeployHistory'
import type { DeployRow } from '../../lib/projectDeployTypes'

function row(overrides: Partial<DeployRow> = {}): DeployRow {
  return {
    id: 13,
    status: 'succeeded',
    trigger: 'deploy',
    tags: {},
    commit: null,
    started_at: '2025-06-15T12:00:00',
    finished_at: null,
    log: '',
    job_id: null,
    ...overrides,
  }
}

const deploys: DeployRow[] = [
  row({ id: 13, status: 'succeeded', log: 'log for 13' }),
  row({ id: 11, status: 'succeeded', log: 'log for 11' }),
  row({ id: 8, status: 'failed', log: 'log for 8' }),
]

function renderHistory(onRedeploy = vi.fn()) {
  return render(
    <DeployHistory
      deploys={deploys}
      isPending={false}
      redeployPending={false}
      onRedeploy={onRedeploy}
    />,
  )
}

describe('DeployHistory', () => {
  it('is expanded by default', () => {
    renderHistory()
    expect(screen.getByText('#13')).toBeInTheDocument()
  })

  it('lists deploy rows with readable status badges', () => {
    renderHistory()
    expect(screen.getAllByText('Succeeded').length).toBeGreaterThan(0)
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('shows a deploy log when Log is clicked and hides it on second click', async () => {
    const user = userEvent.setup()
    renderHistory()

    await user.click(screen.getAllByRole('button', { name: 'Log' })[0]!)
    expect(screen.getByText('log for 13')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Hide log' }))
    expect(screen.queryByText('log for 13')).not.toBeInTheDocument()
  })

  it('expands one row at a time', async () => {
    const user = userEvent.setup()
    renderHistory()

    await user.click(screen.getAllByRole('button', { name: 'Log' })[0]!)
    await user.click(screen.getAllByRole('button', { name: 'Log' })[0]!)

    expect(screen.getByText('log for 11')).toBeInTheDocument()
    expect(screen.queryByText('log for 13')).not.toBeInTheDocument()
  })

  it('redeploy does not open the log', async () => {
    const user = userEvent.setup()
    const onRedeploy = vi.fn()
    renderHistory(onRedeploy)

    await user.click(screen.getAllByRole('button', { name: 'Redeploy' })[0]!)

    expect(onRedeploy).toHaveBeenCalledWith(13)
    expect(screen.queryByText('log for 13')).not.toBeInTheDocument()
  })

  it('shows an empty message when there are no deploys', () => {
    render(
      <DeployHistory
        deploys={[]}
        isPending={false}
        redeployPending={false}
        onRedeploy={vi.fn()}
      />,
    )
    expect(screen.getByText('No deploys yet.')).toBeInTheDocument()
  })
})
