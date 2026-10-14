import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RestoreConfirmDialog } from './RestoreConfirmDialog'

describe('RestoreConfirmDialog', () => {
  it('keeps confirm disabled until text is exactly RESTORE', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <RestoreConfirmDialog
        open
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />,
    )

    const confirm = screen.getByRole('button', { name: /restore cluster/i })
    expect(confirm).toBeDisabled()

    await user.type(screen.getByLabelText(/confirmation/i), 'restore')
    expect(confirm).toBeDisabled()

    await user.clear(screen.getByLabelText(/confirmation/i))
    await user.type(screen.getByLabelText(/confirmation/i), 'RESTORE')
    expect(confirm).toBeEnabled()

    await user.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('shows the drop list and requires ticking overwrite when the cluster is not empty', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <RestoreConfirmDialog
        open
        conflict={{ databases: ['appdb', 'gmail_manager'], roles: ['appuser'] }}
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />,
    )

    expect(screen.getByText('appdb')).toBeInTheDocument()
    expect(screen.getByText('gmail_manager')).toBeInTheDocument()
    expect(screen.getByText('appuser')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/confirmation/i), 'RESTORE')
    const confirm = screen.getByRole('button', { name: /restore cluster/i })
    expect(confirm).toBeDisabled()

    await user.click(screen.getByLabelText(/overwrite existing data/i))
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('warns that attached projects keep the panel password until rotate and deploy', () => {
    render(
      <RestoreConfirmDialog
        open
        attachedProjects={['budget-hq', 'spliteasy']}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    )

    expect(
      screen.getByText(/attached projects keep the passwords stored by this panel/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/rotate its database password and deploy/i)).toBeInTheDocument()
    expect(screen.getByText('budget-hq')).toBeInTheDocument()
    expect(screen.getByText('spliteasy')).toBeInTheDocument()
  })

  it('hides the attached-project warning when nothing is attached', () => {
    render(
      <RestoreConfirmDialog open onConfirm={() => undefined} onCancel={() => undefined} />,
    )

    expect(
      screen.queryByText(/attached projects keep the passwords stored by this panel/i),
    ).not.toBeInTheDocument()
  })

  it('confirms without overwrite when the cluster has no conflict', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <RestoreConfirmDialog
        open
        onConfirm={onConfirm}
        onCancel={() => undefined}
      />,
    )
    await user.type(screen.getByLabelText(/confirmation/i), 'RESTORE')
    await user.click(screen.getByRole('button', { name: /restore cluster/i }))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })
})
