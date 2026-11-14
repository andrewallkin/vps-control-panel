import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Badge } from './Badge'

describe('Badge', () => {
  it('renders child text', () => {
    render(<Badge tone="success">Healthy</Badge>)
    expect(screen.getByText('Healthy')).toBeInTheDocument()
  })
})