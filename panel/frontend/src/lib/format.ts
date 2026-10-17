const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  const day = date.getDate()
  const month = MONTH_NAMES[date.getMonth()]
  const year = date.getFullYear()
  const hours = pad2(date.getHours())
  const minutes = pad2(date.getMinutes())
  const seconds = pad2(date.getSeconds())
  return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds}`
}

const DOCKER_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})?/

const SAST_OFFSET_MINUTES = 2 * 60

export function formatStartedAt(raw: string): string {
  const match = DOCKER_TIMESTAMP_RE.exec(raw)
  if (!match) {
    return raw
  }
  const [, year, month, day, hours, minutes, seconds, sign, offH, offM] = match
  const offsetMinutes =
    (Number(offH) * 60 + Number(offM ?? '00')) * (sign === '-' ? -1 : 1)
  const utcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  )
  const sast = new Date(utcMs + (SAST_OFFSET_MINUTES - offsetMinutes) * 60_000)
  return (
    `${pad2(sast.getUTCDate())}-${pad2(sast.getUTCMonth() + 1)}-${sast.getUTCFullYear()} ` +
    `${pad2(sast.getUTCHours())}:${pad2(sast.getUTCMinutes())}:${pad2(sast.getUTCSeconds())} SAST`
  )
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '—'
  }
  if (bytes === 0) {
    return '0 B'
  }
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    BYTE_UNITS.length - 1,
  )
  const value = bytes / 1024 ** exp
  const digits =
    value >= 100 ? 0 : value >= 10 ? 1 : Number.isInteger(value) ? 0 : 1
  return `${value.toFixed(digits)} ${BYTE_UNITS[exp]}`
}

export function formatPercent(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) {
    return '—'
  }
  return `${value.toFixed(fractionDigits)}%`
}

export function formatSecondsAgo(dataUpdatedAtMs: number, nowMs: number): string {
  if (dataUpdatedAtMs <= 0) {
    return 'never'
  }
  const seconds = Math.max(0, Math.floor((nowMs - dataUpdatedAtMs) / 1000))
  return `${seconds}s ago`
}

export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '—'
  }
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) {
    parts.push(`${days}d`)
  }
  if (hours > 0 || days > 0) {
    parts.push(`${hours}h`)
  }
  parts.push(`${minutes}m`)
  return parts.join(' ')
}

export function formatLoad(load: number, cpuCount: number): string {
  if (!Number.isFinite(load) || !Number.isFinite(cpuCount) || cpuCount <= 0) {
    return '—'
  }
  return `${load.toFixed(2)} / ${cpuCount}`
}

export function formatPushedAtRelative(pushedAtIso: string, nowMs: number): string {
  const pushedMs = Date.parse(pushedAtIso)
  if (!Number.isFinite(pushedMs)) {
    return '—'
  }
  const seconds = Math.max(0, Math.floor((nowMs - pushedMs) / 1000))
  if (seconds < 60) {
    return 'just now'
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
