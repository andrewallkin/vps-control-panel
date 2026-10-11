import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RemoveDomainDialog } from './RemoveDomainDialog'

describe('RemoveDomainDialog', () => {
  it('confirms removal for the selected domain', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <RemoveDomainDialog
        open
        domainName="example.com"
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />,
    )

    expect(screen.getByRole('alertdialog', { name: /remove domain/i })).toBeInTheDocument()
    expect(screen.getByText(/example\.com/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^remove domain$/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
