import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LogViewer } from './LogViewer'

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  listeners: Record<string, Array<(event: MessageEvent<string>) => void>> = {}
  closed = false

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, handler: (event: MessageEvent<string>) => void) {
    this.listeners[type] = this.listeners[type] ?? []
    this.listeners[type].push(handler)
  }

  close() {
    this.closed = true
  }

  emit(type: string, data: string) {
    for (const handler of this.listeners[type] ?? []) {
      handler({ data } as MessageEvent<string>)
    }
  }
}

describe('LogViewer', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('pause stops autoscroll when new lines arrive', async () => {
    const user = userEvent.setup()
    render(<LogViewer jobId="job-1" />)

    const source = MockEventSource.instances[0]
    expect(source.url).toBe('/api/jobs/job-1/events')

    await user.click(screen.getByRole('button', { name: /pause scroll/i }))

    const scrollContainer = screen.getByTestId('log-scroll')
    scrollContainer.scrollTop = 0

    source.emit('line', JSON.stringify({ n: 0, text: 'first line' }))
    source.emit('line', JSON.stringify({ n: 1, text: 'second line' }))

    await waitFor(() => {
      expect(screen.getByText('second line')).toBeInTheDocument()
    })

    expect(scrollContainer.scrollTop).toBe(0)
  })
})
