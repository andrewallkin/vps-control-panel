import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MigrationRunControls } from './MigrationRunControls'

describe('MigrationRunControls', () => {
  it('shows a pre-ticked Run database migrations checkbox with the command', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <MigrationRunControls
        configured
        command="bash /app/run_migrations.sh"
        runMigrations
        onToggle={onToggle}
        onRunNow={vi.fn()}
      />,
    )
    const checkbox = screen.getByRole('checkbox', { name: /run database migrations/i })
    expect(checkbox).toBeChecked()
    expect(screen.getByText(/bash \/app\/run_migrations\.sh/)).toBeInTheDocument()
    await user.click(checkbox)
    expect(onToggle).toHaveBeenCalledWith(false)
  })

  it('banners an unconfigured database project', () => {
    render(
      <MigrationRunControls
        configured={false}
        command={null}
        runMigrations={false}
        onToggle={vi.fn()}
        onRunNow={vi.fn()}
        hasDatabase
      />,
    )
    expect(screen.getByText(/migrations are not configured/i)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('offers a standalone Run migrations button when configured', async () => {
    const user = userEvent.setup()
    const onRunNow = vi.fn()
    render(
      <MigrationRunControls
        configured
        command="alembic upgrade head"
        runMigrations
        onToggle={vi.fn()}
        onRunNow={onRunNow}
      />,
    )
    await user.click(screen.getByRole('button', { name: /run migrations/i }))
    expect(onRunNow).toHaveBeenCalledOnce()
  })
})
