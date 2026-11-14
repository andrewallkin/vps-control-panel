import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './Dialog'

function TestDialog({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(true)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent busy={busy} aria-describedby={undefined}>
        <DialogTitle>Delete project</DialogTitle>
        <DialogDescription>This cannot be undone.</DialogDescription>
      </DialogContent>
    </Dialog>
  )
}

describe('Dialog', () => {
  it('closes on Escape when not busy', async () => {
    const user = userEvent.setup()
    render(<TestDialog />)
    expect(screen.getByRole('dialog', { name: 'Delete project' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Delete project' })).not.toBeInTheDocument()
  })

  it('does not close on Escape when busy', async () => {
    const user = userEvent.setup()
    render(<TestDialog busy />)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Delete project' })).toBeInTheDocument()
  })
})