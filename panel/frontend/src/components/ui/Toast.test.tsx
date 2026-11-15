import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from './Toast'

function ToastTrigger({
  options,
}: {
  options: Parameters<ReturnType<typeof useToast>['toast']>[0]
}) {
  const { toast } = useToast()
  return (
    <button type="button" onClick={() => toast(options)}>
      Show toast
    </button>
  )
}

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows title and description', () => {
    render(
      <ToastProvider>
        <ToastTrigger
          options={{ title: 'Saved', description: 'Settings updated', tone: 'info' }}
        />
      </ToastProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show toast' }))

    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByText('Settings updated')).toBeInTheDocument()
  })

  it('auto-dismisses after the default duration', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <ToastTrigger options={{ title: 'Done' }} />
      </ToastProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show toast' }))
    expect(screen.getByText('Done')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5200)
    })

    expect(screen.queryByText('Done')).not.toBeInTheDocument()
  })

  it('auto-dismisses danger toasts after 8 seconds', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <ToastTrigger options={{ title: 'Failed', tone: 'danger' }} />
      </ToastProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show toast' }))

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('Failed')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3200)
    })
    expect(screen.queryByText('Failed')).not.toBeInTheDocument()
  })

  it('dismisses via the close button', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <ToastTrigger options={{ title: 'Notice' }} />
      </ToastProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show toast' }))
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))

    await waitFor(() => {
      expect(screen.queryByText('Notice')).not.toBeInTheDocument()
    })
  })

  it('useToast is a no-op outside a provider', async () => {
    const user = userEvent.setup()
    render(<ToastTrigger options={{ title: 'Ghost' }} />)

    await user.click(screen.getByRole('button', { name: 'Show toast' }))

    expect(screen.queryByText('Ghost')).not.toBeInTheDocument()
  })
})
