import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Alert } from './Alert'

describe('Alert', () => {
  it('uses role=alert for warning', () => {
    render(<Alert tone="warning" title="Heads up">Details</Alert>)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('uses role=status for info', () => {
    render(<Alert tone="info" title="Note">Details</Alert>)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})