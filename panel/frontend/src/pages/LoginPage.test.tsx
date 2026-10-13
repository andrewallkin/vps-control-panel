import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'
import { renderWithProviders } from '../test/renderWithProviders'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubWindowLocation(pathname: string) {
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, pathname, assign },
  })
  return assign
}

describe('LoginPage', () => {
  beforeEach(() => {
    stubWindowLocation('/login')
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/api/auth/me')) {
          return Promise.resolve(jsonResponse({ detail: 'unauthorized' }, 401))
        }
        return Promise.resolve(jsonResponse({}))
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows validation errors for empty fields and short code', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, { routerProps: { initialEntries: ['/login'] } })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('Username is required')).toBeInTheDocument()
    expect(screen.getByText('Password is required')).toBeInTheDocument()
    expect(screen.getByText('Authentication code is required')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/password/i), 'secret')
    await user.type(screen.getByLabelText(/authenticator code/i), '12345')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('Code must be exactly 6 digits')).toBeInTheDocument()
  })

  it('shows invalid credentials message on 401', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(jsonResponse({ detail: 'unauthorized' }, 401))
      }
      if (url.includes('/api/auth/login') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({ detail: 'invalid_credentials' }, 401),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, { routerProps: { initialEntries: ['/login'] } })

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/password/i), 'wrong')
    await user.type(screen.getByLabelText(/authenticator code/i), '123456')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('Invalid credentials.')).toBeInTheDocument()
  })

  it('shows lockout countdown on 429 and blocks resubmit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(jsonResponse({ detail: 'unauthorized' }, 401))
      }
      if (url.includes('/api/auth/login') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({ detail: 'locked', retry_after_seconds: 3 }, 429),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<LoginPage />, { routerProps: { initialEntries: ['/login'] } })

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/password/i), 'wrong')
    await user.type(screen.getByLabelText(/authenticator code/i), '123456')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(
      await screen.findByText(/try again in 3 seconds/i),
    ).toBeInTheDocument()

    const loginCallsAfterLock = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/api/auth/login'),
    ).length

    await user.click(screen.getByRole('button', { name: /sign in/i }))

    const loginCallsAfterResubmit = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/api/auth/login'),
    ).length

    expect(loginCallsAfterResubmit).toBe(loginCallsAfterLock)

    vi.advanceTimersByTime(3000)

    await waitFor(() => {
      expect(screen.queryByText(/try again in/i)).not.toBeInTheDocument()
    })

    vi.useRealTimers()
  })

  it('shows a session error when sign-in succeeds but the session check fails', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(jsonResponse({ detail: 'unauthorized' }, 401))
      }
      if (url.includes('/api/auth/login') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({ username: 'admin', csrf_token: 'csrf-token' }),
        )
      }
      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    renderWithProviders(<LoginPage />, { routerProps: { initialEntries: ['/login'] } })

    await waitFor(() => {
      expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/username/i), 'admin')
    await user.type(screen.getByLabelText(/password/i), 'correct-password')
    await user.type(screen.getByLabelText(/authenticator code/i), '123456')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(
      await screen.findByText(/session could not be established/i),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Something went wrong. Try again.'),
    ).not.toBeInTheDocument()
  })
})
