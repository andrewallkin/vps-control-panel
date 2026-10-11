import { formatBytes } from '../../lib/format'

export interface ProgressBarProps {
  sent: number
  total: number
  bytesPerSec: number
  etaSec: number | null
  label?: string
}

function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return '—'
  }
  if (seconds < 60) {
    return `${Math.ceil(seconds)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const secs = Math.ceil(seconds % 60)
  return `${minutes}m ${secs}s`
}

export function ProgressBar({
  sent,
  total,
  bytesPerSec,
  etaSec,
  label = 'Upload progress',
}: ProgressBarProps) {
  const ratio = total > 0 ? Math.min(1, sent / total) : 0
  const percent = Math.round(ratio * 100)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {formatBytes(sent)} / {formatBytes(total)}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatBytes(bytesPerSec)}/s · ETA {formatEta(etaSec)}
      </p>
    </div>
  )
}
