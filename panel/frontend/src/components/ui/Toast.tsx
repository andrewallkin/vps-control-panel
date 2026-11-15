import { CheckCircle, Info, Warning, X, XCircle } from '@phosphor-icons/react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { cn } from '../../lib/cn'

export type ToastTone = 'success' | 'danger' | 'info' | 'warning'

export interface ToastInput {
  title: string
  description?: string
  tone?: ToastTone
}

interface ToastRecord extends Required<Pick<ToastInput, 'title' | 'tone'>> {
  id: string
  description?: string
  dismissing?: boolean
}

interface ToastContextValue {
  toast: (input: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const toneConfig: Record<
  ToastTone,
  {
    role: 'status' | 'alert'
    live: 'polite' | 'assertive'
    icon: ReactNode
    surface: string
    iconClass: string
  }
> = {
  success: {
    role: 'status',
    live: 'polite',
    icon: <CheckCircle weight="fill" aria-hidden className="size-4 shrink-0" />,
    surface: 'bg-muted',
    iconClass: 'text-accent',
  },
  info: {
    role: 'status',
    live: 'polite',
    icon: <Info weight="fill" aria-hidden className="size-4 shrink-0" />,
    surface: 'bg-secondary',
    iconClass: 'text-info',
  },
  warning: {
    role: 'alert',
    live: 'polite',
    icon: <Warning weight="fill" aria-hidden className="size-4 shrink-0" />,
    surface: 'bg-secondary',
    iconClass: 'text-warning',
  },
  danger: {
    role: 'alert',
    live: 'assertive',
    icon: <XCircle weight="fill" aria-hidden className="size-4 shrink-0" />,
    surface: 'bg-muted',
    iconClass: 'text-destructive',
  },
}

function durationForTone(tone: ToastTone) {
  return tone === 'danger' ? 8000 : 5000
}

let toastId = 0

function nextToastId() {
  toastId += 1
  return `toast-${toastId}`
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    return { toast: () => {} }
  }
  return ctx
}

function ToastItem({
  record,
  onDismiss,
}: {
  record: ToastRecord
  onDismiss: (id: string) => void
}) {
  const config = toneConfig[record.tone]
  const titleId = useId()
  const descriptionId = useId()
  const pauseRef = useRef(false)
  const remainingRef = useRef(durationForTone(record.tone))
  const deadlineRef = useRef(0)
  const timeoutRef = useRef<number | null>(null)

  const clearTimer = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  const schedule = useCallback(() => {
    clearTimer()
    timeoutRef.current = window.setTimeout(() => {
      onDismiss(record.id)
    }, remainingRef.current)
  }, [onDismiss, record.id])

  useEffect(() => {
    remainingRef.current = durationForTone(record.tone)
    deadlineRef.current = Date.now() + remainingRef.current
    schedule()
    return clearTimer
  }, [record.id, record.tone, schedule])

  const pause = () => {
    pauseRef.current = true
    remainingRef.current = Math.max(0, deadlineRef.current - Date.now())
    clearTimer()
  }

  const resume = () => {
    if (!pauseRef.current) {
      return
    }
    pauseRef.current = false
    deadlineRef.current = Date.now() + remainingRef.current
    schedule()
  }

  const dismiss = () => {
    clearTimer()
    onDismiss(record.id)
  }

  return (
    <MotionSafeToast
      dismissing={record.dismissing}
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-border px-4 py-3 text-sm text-foreground shadow-popover',
        config.surface,
      )}
      role={config.role}
      aria-live={config.live}
      aria-atomic="true"
      aria-labelledby={titleId}
      aria-describedby={record.description ? descriptionId : undefined}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <span className={cn('mt-0.5', config.iconClass)}>{config.icon}</span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p id={titleId} className="font-medium">
          {record.title}
        </p>
        {record.description ? (
          <p id={descriptionId} className="text-muted-foreground">
            {record.description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground cursor-pointer"
        aria-label="Dismiss notification"
        onClick={dismiss}
      >
        <X weight="bold" aria-hidden className="size-4" />
      </button>
    </MotionSafeToast>
  )
}

function MotionSafeToast({
  dismissing,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { dismissing?: boolean }) {
  return (
    <div
      className={cn(
        'transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
        dismissing
          ? 'opacity-0 translate-y-1 motion-reduce:opacity-100 motion-reduce:translate-y-0'
          : 'opacity-100 translate-y-0',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastRecord[]>([])
  const regionId = useId()

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, dismissing: true } : item)))
    window.setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id))
    }, 200)
  }, [])

  const toast = useCallback((input: ToastInput) => {
    const record: ToastRecord = {
      id: nextToastId(),
      title: input.title,
      description: input.description,
      tone: input.tone ?? 'success',
    }
    setItems((prev) => {
      const next = [...prev, record]
      while (next.length > 3) {
        next.shift()
      }
      return next
    })
  }, [])

  const live = items.some((item) => item.tone === 'danger') ? 'assertive' : 'polite'

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        id={regionId}
        aria-live={live}
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end"
      >
        {items.map((item) => (
          <ToastItem key={item.id} record={item} onDismiss={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
