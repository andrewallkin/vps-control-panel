import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { EnvEditor } from './EnvEditor'

describe('EnvEditor', () => {
  it('applies bulk paste without overwriting locked keys', async () => {
    const user = userEvent.setup()

    render(
      <EnvEditor
        rows={[
          { key: 'POSTGRES_PASSWORD', value: 'original-secret', locked: true },
          { key: 'FOO', value: '', locked: false },
        ]}
        routePortEnvVars={[]}
        onChange={() => undefined}
      />,
    )

    await user.click(screen.getByRole('button', { name: /paste \.env/i }))
    const textarea = screen.getByLabelText(/paste \.env/i)
    await user.clear(textarea)
    await user.type(textarea, 'FOO=barbaz12\n# c\nPOSTGRES_PASSWORD=stolen\n')
    await user.click(screen.getByRole('button', { name: /apply paste/i }))

    expect(screen.getByLabelText(/^FOO$/i)).toHaveValue('••••12')
    expect(screen.getByLabelText(/^POSTGRES_PASSWORD$/i)).toHaveValue('original-secret')
  })

  it('masks unlocked env values when not focused', () => {
    render(
      <EnvEditor
        rows={[{ key: 'SECRET', value: 'abcdefgh', locked: false }]}
        routePortEnvVars={[]}
        onChange={() => undefined}
      />,
    )

    expect(screen.getByLabelText(/^SECRET$/i)).toHaveValue('••••gh')
  })
})
