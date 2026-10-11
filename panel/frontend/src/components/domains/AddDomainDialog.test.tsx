import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AddDomainDialog } from './AddDomainDialog'

const zones = [
  { id: 'zone-a', name: 'example.com', status: 'active' },
  { id: 'zone-b', name: 'other.test', status: 'active' },
]

describe('AddDomainDialog', () => {
  it('defaults domain to the selected zone and submits the registration payload', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()

    render(
      <AddDomainDialog open zones={zones} onCancel={() => undefined} onSubmit={onSubmit} />,
    )

    expect(screen.getByText(/subdomain zones/i)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/cloudflare zone/i), 'zone-b')
    expect(screen.getByLabelText(/domain name/i)).toHaveValue('other.test')

    await user.click(screen.getByRole('button', { name: /add domain/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'other.test',
      zone_id: 'zone-b',
    })
  })
})
