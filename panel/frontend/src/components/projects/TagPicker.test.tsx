import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TagPicker } from './TagPicker'
import type { RegistryTagOption } from '../../lib/projectDeployTypes'

const tags: RegistryTagOption[] = [
  {
    name: 'backend-main-abc1234',
    sha: 'abc1234',
    pushed_at: '2024-01-01T10:00:00Z',
  },
  {
    name: 'backend-main-def5678',
    sha: 'def5678',
    pushed_at: '2024-01-01T08:00:00Z',
  },
]

describe('TagPicker', () => {
  it('preselects the first tag and shows sha and relative pushed time', () => {
    const now = Date.parse('2024-01-01T12:00:00Z')

    render(
      <TagPicker
        tags={tags}
        selectedName={tags[0]!.name}
        onSelectedNameChange={() => undefined}
        now={now}
      />,
    )

    expect(screen.getByRole('combobox')).toHaveValue('backend-main-abc1234')
    expect(screen.getByText('abc1234')).toBeInTheDocument()
    expect(screen.getByText(/2 hours ago/)).toBeInTheDocument()
  })
})
