import { useEffect, useRef, useState } from 'react'
import type { DeployRow } from '../../lib/projectDeployTypes'
import { useJobLogStream } from '../../lib/useJobLogStream'

export const DEPLOY_LOG_HOLD_MS = 10_000

const STICK_THRESHOLD_PX = 24

export function DeployLogBox({ deploy }: { deploy: DeployRow }) {
  const terminal = deploy.status !== 'running'
  const streaming = deploy.status === 'running' && Boolean(deploy.job_id)
  const { lines } = useJobLogStream(streaming ? deploy.job_id : null)
  const [holdExpired, setHoldExpired] = useState(false)
  const scrollRef = useRef<HTMLPreElement>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    if (!terminal) {
      return
    }
    const timer = window.setTimeout(() => setHoldExpired(true), DEPLOY_LOG_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [terminal, deploy.id])

  const streamedText = lines.length
    ? lines.filter((line) => line !== undefined).join('\n')
    : ''
  const text = terminal ? deploy.log : streamedText || deploy.log

  useEffect(() => {
    const node = scrollRef.current
    if (node && stickToBottomRef.current) {
      node.scrollTop = node.scrollHeight
    }
  }, [text])

  if (holdExpired || (!streaming && !text)) {
    return null
  }

  const handleScroll = () => {
    const node = scrollRef.current
    if (!node) {
      return
    }
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    stickToBottomRef.current = distanceFromBottom < STICK_THRESHOLD_PX
  }

  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">
        {terminal ? 'Deploy log' : 'Deploying…'}
      </h2>
      <pre
        ref={scrollRef}
        onScroll={handleScroll}
        aria-label="Deploy log"
        data-testid="deploy-log-box"
        className="max-h-64 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs"
      >
        {text || 'Waiting for log…'}
      </pre>
    </section>
  )
}
