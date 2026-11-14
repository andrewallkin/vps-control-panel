import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Switch } from './Switch'

function ControlledSwitch() {
  const [checked, setChecked] = useState(false)
  return <Switch checked={checked} onCheckedChange={setChecked} aria-label="Enable backups" />
}

describe('Switch', () => {
  it('toggles aria-checked on click', async () => {
    const user = userEvent.setup()
    render(<ControlledSwitch />)
    const control = screen.getByRole('switch', { name: 'Enable backups' })
    expect(control).toHaveAttribute('aria-checked', 'false')
    await user.click(control)
    expect(control).toHaveAttribute('aria-checked', 'true')
  })
})