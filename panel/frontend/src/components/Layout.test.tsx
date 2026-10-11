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
})
