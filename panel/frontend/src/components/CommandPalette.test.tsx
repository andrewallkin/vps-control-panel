import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import {
  CommandPalette,
  CommandPaletteSearchButton,
  useCommandPaletteHotkeys,
} from './CommandPalette'
import { Layout } from './Layout'
import { renderWithProviders } from '../test/renderWithProviders'
import * as projectsApi from '../lib/projectsApi'

vi.mock('../lib/projectsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof projectsApi>()
  return {
    ...actual,
    fetchProjects: vi.fn(),
  }
})

const fetchProjects = vi.mocked(projectsApi.fetchProjects)

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="pathname">{pathname}</div>
}

function PaletteWithHotkeys() {
  const [open, setOpen] = useState(false)
  useCommandPaletteHotkeys(() => setOpen(true))
  return (
    <>
      <CommandPaletteSearchButton onClick={() => setOpen(true)} />
      <CommandPalette open={open} onOpenChange={setOpen} />
    </>
  )
}

describe('CommandPalette', () => {
  it('opens with Ctrl+K and via the search trigger', async () => {
    const user = userEvent.setup()

    renderWithProviders(<PaletteWithHotkeys />, { routerProps: { initialEntries: ['/'] } })

    await user.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('combobox')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: /search/i }))
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('filters results and navigates with arrow keys and Enter', async () => {
    fetchProjects.mockResolvedValue([])

    const user = userEvent.setup()
    renderWithProviders(
      <>
        <LocationProbe />
        <CommandPalette open onOpenChange={() => {}} />
      </>,
      { routerProps: { initialEntries: ['/'] } },
    )

    const input = screen.getByRole('combobox')
    await user.type(input, 'fire')

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Firewall' })).toBeInTheDocument()
    })

    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => {
      expect(screen.getByTestId('pathname')).toHaveTextContent('/firewall')
    })
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    renderWithProviders(<CommandPalette open onOpenChange={onOpenChange} />, {
      routerProps: { initialEntries: ['/'] },
    })

    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('opens from the layout search button', async () => {
    fetchProjects.mockResolvedValue([])
    const user = userEvent.setup()

    renderWithProviders(
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<p>Home</p>} />
        </Route>
      </Routes>,
      { routerProps: { initialEntries: ['/'] } },
    )

    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })
})
