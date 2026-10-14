import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposeLogsViewer } from './ComposeLogsViewer'

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  close() {}

  emit(data: string) {
    this.onmessage?.({ data } as MessageEvent<string>)
  }
}

const healthLine =
  'backend-1 | 2026-10-14T18:10:37.095884931Z INFO: 127.0.0.1:36298 - "GET /api/health HTTP/1.1" 200 OK'
const appLine = 'backend-1 | "GET /api/expenses HTTP/1.1" 200 OK'

describe('ComposeLogsViewer health checks', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hides health checks until the toggle is turned on', async () => {
    const user = userEvent.setup()
    render(<ComposeLogsViewer slug="demo" service="" />)

    const source = MockEventSource.instances[0]
    source?.emit(healthLine)
    source?.emit(appLine)

    expect(await screen.findByText(appLine)).toBeInTheDocument()
    expect(screen.queryByText(healthLine)).not.toBeInTheDocument()

    const toggle = screen.getByRole('switch', { name: 'Health checks' })
    expect(toggle).not.toBeChecked()

    await user.click(toggle)

    expect(await screen.findByText(healthLine)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Health checks' })).toBeChecked()
    })
  })
})
