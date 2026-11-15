import { CheckCircle } from '@phosphor-icons/react'
import { useEffect } from 'react'
import { cn } from '../lib/cn'

export interface ToastProps {
  message: string
  onDismiss: () => void
  durationMs?: number
}

export function Toast({ message, onDismiss, durationMs = 5000 }: ToastProps) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, durationMs)
    return () => window.clearTimeout(id)
  }, [durationMs, onDismiss, message])

  return (
    <div
      role="status"
      className={cn(
        'fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-base text-foreground shadow-popover',
      )}
    >
      <CheckCircle weight="fill" aria-hidden className="mt-0.5 size-4 shrink-0 text-[#047857]" />
      <span className="min-w-0 flex-1">{message}</span>
    </div>
  )
}