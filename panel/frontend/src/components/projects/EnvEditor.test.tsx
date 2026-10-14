import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { EnvRow } from '../../lib/envEditorUtils'
import { EnvEditor } from './EnvEditor'

function EnvEditorHarness({ initialRows }: { initialRows: EnvRow[] }) {
  const [rows, setRows] = useState(initialRows)
  return <EnvEditor rows={rows} routePortEnvVars={[]} onChange={(next) => setRows(next)} />
}

describe('EnvEditor', () => {
  it('applies bulk paste without overwriting locked keys', async () => {
    const user = userEvent.setup()

    render(
      <EnvEditorHarness
        initialRows={[
          { key: 'POSTGRES_PASSWORD', value: 'original-secret', locked: true },
          { key: 'FOO', value: '', locked: false },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: /paste \.env/i }))
    const textarea = screen.getByLabelText(/paste \.env/i)
    await user.clear(textarea)
    await user.type(textarea, 'FOO=barbaz12\n# c\nPOSTGRES_PASSWORD=stolen\n')
    await user.click(screen.getByRole('button', { name: /apply paste/i }))

    expect(screen.getByRole('button', { name: /^FOO$/i })).toHaveTextContent('barbaz12')
    expect(screen.getByRole('button', { name: /^POSTGRES_PASSWORD$/i })).toHaveTextContent(
      'original-secret',
    )
  })

  it('opens the full field when a key or value is clicked', async () => {
    const user = userEvent.setup()

    render(
      <EnvEditorHarness initialRows={[{ key: '', value: '', locked: false }]} />,
    )

    await user.click(screen.getByRole('button', { name: 'New key' }))
    const keyInput = screen.getByRole('textbox', { name: 'Full key' })
    await user.type(keyInput, 'app_name')

    expect(keyInput).toHaveFocus()
    expect(keyInput).toHaveValue('APP_NAME')
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await user.click(screen.getByRole('button', { name: /^APP_NAME$/i }))
    const valueInput = screen.getByRole('textbox', { name: 'Full value' })
    await user.type(valueInput, 'SplitEasy API')

    expect(valueInput).toHaveFocus()
    expect(valueInput).toHaveValue('SplitEasy API')
  })

  it('blocks renaming a row to a managed key', async () => {
    const user = userEvent.setup()
    render(
      <EnvEditorHarness
        initialRows={[{ key: 'FOO', value: 'bar', locked: false }]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'FOO key' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Full key' }), {
      target: { value: 'POSTGRES_PASSWORD' },
    })

    expect(screen.queryByRole('button', { name: 'POSTGRES_PASSWORD key' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'FOO key' })).toBeInTheDocument()
  })
})
