import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SslModeBadge } from './SslModeBadge'

describe('SslModeBadge', () => {
  it('shows permission message when ssl mode read is denied', () => {
    render(
      <SslModeBadge sslMode={null} sslModeError="permission" warning={null} />,
    )
    expect(screen.getByText('Zone Settings:Read required')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Add Zone Settings:Read on the Cloudflare token, then save it in Settings.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument()
  })
})
