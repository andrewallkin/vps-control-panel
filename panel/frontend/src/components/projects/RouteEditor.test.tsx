import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RouteEditor } from './RouteEditor'

describe('RouteEditor', () => {
  it('validates path prefix and port env var for Continue', async () => {
    const user = userEvent.setup()
    const onValidationChange = vi.fn()

    render(
      <RouteEditor
        routes={[{ path_prefix: '/', port_env_var: '' }]}
        onChange={() => undefined}
        onValidationChange={onValidationChange}
      />,
    )

    const pathInput = screen.getByLabelText(/path prefix/i)
    const portInput = screen.getByLabelText(/port env var/i)

    await user.clear(pathInput)
    await user.type(pathInput, '/api')
    await user.clear(portInput)
    await user.type(portInput, 'WEB_PORT')

    expect(onValidationChange).toHaveBeenLastCalledWith({ ok: true })

    await user.clear(pathInput)
    await user.type(pathInput, '../x')
    expect(onValidationChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ ok: false }),
    )

    await user.clear(pathInput)
    await user.type(pathInput, '/api')
    await user.clear(portInput)
    await user.type(portInput, 'port')
    expect(onValidationChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ ok: false }),
    )
  })
})
