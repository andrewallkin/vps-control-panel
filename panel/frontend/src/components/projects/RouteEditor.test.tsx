import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RouteEditor } from './RouteEditor'

describe('RouteEditor', () => {
  it('explains that a route forwards a path prefix to a compose port', () => {
    render(
      <RouteEditor
        routes={[{ path_prefix: '/', port_env_var: '' }]}
        onChange={() => undefined}
      />,
    )

    expect(screen.getByText(/path is not rewritten/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/port env var/i)).toHaveAttribute('placeholder', 'WEB_PORT')
  })

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

  it('exposes per-route proxy options and rejects streaming+websocket', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onValidationChange = vi.fn()

    render(
      <RouteEditor
        routes={[
          {
            path_prefix: '/mcp',
            port_env_var: 'MCP_PORT',
            streaming: true,
            websocket: false,
            pass_authorization: false,
            max_body_mb: 25,
            read_timeout_s: 60,
            send_timeout_s: 60,
          },
        ]}
        onChange={onChange}
        onValidationChange={onValidationChange}
      />,
    )

    expect(screen.getByLabelText(/streaming/i)).toBeChecked()

    await user.click(screen.getByLabelText(/pass authorization/i))
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ path_prefix: '/mcp', pass_authorization: true }),
    ])

    await user.click(screen.getByLabelText(/^websocket$/i))
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ streaming: true, websocket: true }),
    ])
    expect(onValidationChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ ok: false }),
    )
  })
})
