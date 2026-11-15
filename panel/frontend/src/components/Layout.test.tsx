import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Route, Routes } from 'react-router-dom'
import { Layout } from './Layout'
import { renderWithProviders } from '../test/renderWithProviders'

describe('Layout', () => {
  it('shows Dashboard navigation and toggles the mobile drawer', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<p>Page content</p>} />
        </Route>
      </Routes>,
      { routerProps: { initialEntries: ['/'] } },
    )

    expect(screen.getAllByRole('link', { name: /dashboard/i }).length).toBeGreaterThan(0)
    expect(screen.getByText('Page content')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /open navigation menu/i }))

    expect(screen.getByRole('dialog', { name: /menu/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /close navigation menu/i }))

    expect(screen.queryByRole('dialog', { name: /menu/i })).not.toBeInTheDocument()
  })

  it('marks the active nav link with aria-current', () => {
    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route path="/firewall" element={<p>Firewall</p>} />
        </Route>
      </Routes>,
      { routerProps: { initialEntries: ['/firewall'] } },
    )

    const firewallLinks = screen.getAllByRole('link', { name: /firewall/i })
    expect(firewallLinks.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true)
  })

  it('exposes skip to content targeting main', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<p>Page content</p>} />
        </Route>
      </Routes>,
      { routerProps: { initialEntries: ['/'] } },
    )

    const skip = screen.getByRole('link', { name: /skip to content/i })
    expect(skip).toHaveAttribute('href', '#main-content')
    await user.click(skip)
    expect(document.getElementById('main-content')).toHaveFocus()
  })
})
