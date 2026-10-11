import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ServiceMappingEditor } from './ServiceMappingEditor'

describe('ServiceMappingEditor', () => {
  it('adds a row', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ServiceMappingEditor services={[]} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /add service/i }))
    expect(onChange).toHaveBeenCalledWith([
      { service_name: '', image_env_var: '', tag_prefix: '' },
    ])
  })

  it('removes a row', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ServiceMappingEditor
        services={[
          { service_name: 'web', image_env_var: 'DOCKER_IMAGE_WEB', tag_prefix: 'web' },
        ]}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /remove/i }))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
