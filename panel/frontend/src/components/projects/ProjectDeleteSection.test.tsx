import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectDeleteSection } from './ProjectDeleteSection'

vi.mock('../StepUpDialog', () => ({
  StepUpDialog: ({
    open,
    onVerified,
  }: {
    open: boolean
    onVerified: () => void
  }) => (open ? <button type="button" onClick={onVerified}>mock verify</button> : null),
}))

describe('ProjectDeleteSection', () => {
  it('requires typed slug and passes delete options after step-up', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()

    render(<ProjectDeleteSection slug="myapp" onDelete={onDelete} />)

    const deleteButton = screen.getByRole('button', { name: /^delete project$/i })
    expect(deleteButton).toBeDisabled()

    await user.type(screen.getByLabelText(/type slug to confirm/i), 'wrong')
    expect(deleteButton).toBeDisabled()

    await user.clear(screen.getByLabelText(/type slug to confirm/i))
    await user.type(screen.getByLabelText(/type slug to confirm/i), 'myapp')
    expect(deleteButton).toBeEnabled()

    await user.click(screen.getByRole('checkbox', { name: /drop database/i }))
    await user.click(screen.getByRole('checkbox', { name: /remove dns/i }))
    await user.click(deleteButton)
    await user.click(screen.getByRole('button', { name: /mock verify/i }))

    expect(onDelete).toHaveBeenCalledWith({
      confirm: 'myapp',
      drop_database: true,
      remove_dns: true,
    })
  })
})
