import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PortsMappingEditor } from './PortsMappingEditor'
import type { PortDraft, UsedPortRow } from '../../lib/portMappings'

const usedPorts: UsedPortRow[] = [
  { port: 8000, owner: 'spliteasy', env_var: 'BACKEND_PORT' },
  { port: 5432, owner: null, env_var: null },
]

const rows: PortDraft[] = [
  { env_var: 'BACKEND_PORT', default: 8000, host_port: '8001', service: 'backend' },
  { env_var: 'FRONTEND_PORT', default: 3000, host_port: '10001', service: 'frontend' },
]

describe('PortsMappingEditor', () => {
  it('renders one labelled input per row with the compose default', () => {
    render(
      <PortsMappingEditor
        rows={rows}
        usedPorts={usedPorts}
        selfSlug="myapp"
        onChange={vi.fn()}
      />,
    )
    const backend = screen.getByLabelText('BACKEND_PORT host port') as HTMLInputElement
    expect(backend.value).toBe('8001')
    expect(screen.getByText(/compose default 8000/i)).toBeInTheDocument()
  })

  it('emits the updated draft when a port changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <PortsMappingEditor
        rows={rows}
        usedPorts={usedPorts}
        selfSlug="myapp"
        onChange={onChange}
      />,
    )
    await user.type(screen.getByLabelText('BACKEND_PORT host port'), '2')
    const last = onChange.mock.calls.at(-1)![0] as PortDraft[]
    expect(last[0].host_port).toBe('80012')
    expect(last[1]).toEqual(rows[1])
  })

  it('marks ports taken by other projects and system ports, and free ports', () => {
    const conflictRows: PortDraft[] = [
      { env_var: 'BACKEND_PORT', default: 8000, host_port: '8000', service: 'backend' },
      { env_var: 'DB_PORT', default: null, host_port: '5432', service: 'db' },
      { env_var: 'APP_PORT', default: null, host_port: '8001', service: 'app' },
    ]
    render(
      <PortsMappingEditor
        rows={conflictRows}
        usedPorts={usedPorts}
        selfSlug="myapp"
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/used by spliteasy \(BACKEND_PORT\)/i)).toBeInTheDocument()
    expect(screen.getByText(/in use on this server/i)).toBeInTheDocument()
    expect(screen.getByText(/free/i)).toBeInTheDocument()
  })

  it('marks the port already allocated to the same project var as current', () => {
    const own: UsedPortRow[] = [{ port: 10001, owner: 'myapp', env_var: 'FRONTEND_PORT' }]
    render(
      <PortsMappingEditor
        rows={[rows[1]]}
        usedPorts={own}
        selfSlug="myapp"
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/current/i)).toBeInTheDocument()
  })
})

describe('own container bindings', () => {
  it('shows current for a port bound by the same project container without an allocation', () => {
    const own: UsedPortRow[] = [{ port: 8000, owner: 'myapp', env_var: null }]
    render(
      <PortsMappingEditor
        rows={[{ env_var: 'BACKEND_PORT', default: 8000, host_port: '8000', service: 'backend' }]}
        usedPorts={own}
        selfSlug="myapp"
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/^current$/i)).toBeInTheDocument()
  })

  it('shows used by project for a container port owned by another project', () => {
    const foreign: UsedPortRow[] = [{ port: 8000, owner: 'spliteasy', env_var: null }]
    render(
      <PortsMappingEditor
        rows={[{ env_var: 'BACKEND_PORT', default: 8000, host_port: '8000', service: 'backend' }]}
        usedPorts={foreign}
        selfSlug="myapp"
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/used by spliteasy/i)).toBeInTheDocument()
  })
})
