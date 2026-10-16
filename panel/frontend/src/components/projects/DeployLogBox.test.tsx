import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeployLogBox } from './DeployLogBox'
import type { DeployRow } from '../../lib/projectDeployTypes'

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  closed = false
  private listeners = new Map<string, ((event: MessageEvent) => void)[]>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, callback: (event: MessageEvent) => void) {
    const list = this.listeners.get(type) ?? []
    list.push(callback)
    this.listeners.set(type, list)
  }

  emit(type: string, data: string) {
    for (const callback of this.listeners.get(type) ?? []) {
      callback(new MessageEvent(type, { data }))
    }
  }

  close() {
    this.closed = true
  }
}

function row(overrides: Partial<DeployRow> = {}): DeployRow {
  return {
    id: 1,
    status: 'succeeded',
    trigger: 'deploy',
    tags: {},
    commit: null,
    started_at: '2025-06-15T12:00:00',
    finished_at: null,
    log: '',
    job_id: null,
    ...overrides,
  }
}

describe('DeployLogBox', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    vi.stubGlobal('EventSource', MockEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows the persisted log of a finished deploy without opening a stream', () => {
    render(<DeployLogBox deploy={row({ log: 'step 1: git pull\ndone' })} />)

    expect(screen.getByText(/step 1: git pull/)).toBeInTheDocument()
    expect(MockEventSource.instances).toHaveLength(0)
  })

  it('streams live lines over SSE while the deploy is running', () => {
    render(<DeployLogBox deploy={row({ status: 'running', job_id: 'job-1' })} />)

    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toBe('/api/jobs/job-1/events')

    act(() => {
      MockEventSource.instances[0].emit('line', JSON.stringify({ n: 0, text: 'git pull' }))
    })
    expect(screen.getByText('git pull')).toBeInTheDocument()
  })

  it('falls back to the polled log while running when no job stream is available', () => {
    render(<DeployLogBox deploy={row({ status: 'running', job_id: null, log: 'polled line' })} />)

    expect(MockEventSource.instances).toHaveLength(0)
    expect(screen.getByText('polled line')).toBeInTheDocument()
  })

  it('shows the persisted log once the running deploy finishes', () => {
    const { rerender } = render(
      <DeployLogBox deploy={row({ status: 'running', job_id: 'job-1' })} />,
    )

    act(() => {
      MockEventSource.instances[0].emit('line', JSON.stringify({ n: 0, text: 'mid-deploy line' }))
    })
    rerender(<DeployLogBox deploy={row({ status: 'succeeded', log: 'final log', job_id: 'job-1' })} />)

    expect(screen.getByText('final log')).toBeInTheDocument()
    expect(screen.queryByText('mid-deploy line')).not.toBeInTheDocument()
    expect(MockEventSource.instances[0].closed).toBe(true)
  })

  it('hides itself 10 seconds after the deploy finishes', () => {
    vi.useFakeTimers()
    const { rerender } = render(
      <DeployLogBox deploy={row({ status: 'running', job_id: 'job-1' })} />,
    )
    rerender(<DeployLogBox deploy={row({ status: 'succeeded', log: 'done', job_id: 'job-1' })} />)

    expect(screen.getByText('done')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.queryByText('done')).not.toBeInTheDocument()
  })

  it('renders nothing for a finished deploy with an empty log', () => {
    render(<DeployLogBox deploy={row({ status: 'succeeded', log: '' })} />)

    expect(screen.queryByText(/deploy/i)).not.toBeInTheDocument()
  })
})
