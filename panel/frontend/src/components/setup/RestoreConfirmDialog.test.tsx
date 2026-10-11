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
})
