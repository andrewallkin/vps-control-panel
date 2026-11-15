import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Field } from './Field'
import { Input } from './Input'

describe('Field', () => {
  it('wires label, hint, error, and aria attributes', () => {
    render(
      <Field label="Email" hint="Work email only" error="Required">
        {(props) => <Input {...props} placeholder="you@example.com" />}
      </Field>,
    )

    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.getByRole('alert')).toHaveTextContent('Required')
    expect(screen.getByText('Work email only')).toBeInTheDocument()
  })
})