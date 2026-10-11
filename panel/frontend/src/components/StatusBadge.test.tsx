import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBadge, StaleBadge } from './StatusBadge'

describe('StatusBadge', () => {
  it('renders healthy default label', () => {
    render(<StatusBadge variant="healthy" />)
    expect(screen.getByText('Healthy')).toBeInTheDocument()
  })

  it('renders warning with custom label', () => {
    render(<StatusBadge variant="warning" label="Backup overdue" />)
    expect(screen.getByText('Backup overdue')).toBeInTheDocument()
  })

  it('renders critical', () => {
    render(<StatusBadge variant="critical" />)
    expect(screen.getByText('Down')).toBeInTheDocument()
  })
})

describe('StaleBadge', () => {
  it('shows Stale text', () => {
    render(<StaleBadge />)
    expect(screen.getByText('Stale')).toBeInTheDocument()
  })
})
