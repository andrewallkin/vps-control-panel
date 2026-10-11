export interface EnvRow {
  key: string
  value: string
  locked: boolean
  /** True after the user changed this row in the editor (not set from API load). */
  edited?: boolean
}

export function isMaskedEnvPlaceholder(value: string): boolean {
  return value.startsWith('••••')
}

const MANAGED_KEYS = new Set([
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'DATABASE_URL',
])

const PORT_SUFFIX_RE = /^[A-Z0-9_]*PORT$/
const DOCKER_IMAGE_RE = /^DOCKER_IMAGE_[A-Z0-9_]+$/

export function isEnvKeyLocked(key: string, routePortEnvVars: string[]): boolean {
  if (MANAGED_KEYS.has(key)) {
    return true
  }
  if (routePortEnvVars.includes(key)) {
    return true
  }
  if (PORT_SUFFIX_RE.test(key) && routePortEnvVars.includes(key)) {
    return true
  }
  if (DOCKER_IMAGE_RE.test(key)) {
    return true
  }
  return false
}

export function maskEnvValue(value: string, focused: boolean): string {
  if (focused) {
    return value
  }
  if (value.length === 0) {
    return ''
  }
  if (value.length >= 8) {
    return `••••${value.slice(-2)}`
  }
  return '••••'
}

const SECRET_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const SECRET_LENGTH = 48

export function generateSecret(length = SECRET_LENGTH): string {
  const alphabetLength = SECRET_ALPHABET.length
  const maxValid = 256 - (256 % alphabetLength)
  const out: string[] = []
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2)
    crypto.getRandomValues(bytes)
    for (const byte of bytes) {
      if (byte >= maxValid) {
        continue
      }
      out.push(SECRET_ALPHABET[byte % alphabetLength]!)
      if (out.length >= length) {
        break
      }
    }
  }
  return out.join('')
}

export interface EnvPasteLineResult {
  applied: Record<string, string>
  invalidLines: string[]
}

export function parseEnvPaste(text: string): EnvPasteLineResult {
  const applied: Record<string, string> = {}
  const invalidLines: string[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const eq = line.indexOf('=')
    if (eq <= 0) {
      invalidLines.push(rawLine)
      continue
    }
    const key = line.slice(0, eq).trim()
    if (!ENV_KEY_RE.test(key)) {
      invalidLines.push(rawLine)
      continue
    }
    const value = line.slice(eq + 1)
    if (/[\n\r]/.test(value)) {
      invalidLines.push(rawLine)
      continue
    }
    applied[key] = value
  }
  return { applied, invalidLines }
}

const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/

export function applyEnvPaste(
  rows: EnvRow[],
  pasteText: string,
  routePortEnvVars: string[],
): { rows: EnvRow[]; invalidLines: string[] } {
  const { applied, invalidLines } = parseEnvPaste(pasteText)
  const next = rows.map((row) => {
    if (row.locked || !(row.key in applied)) {
      return row
    }
    return { ...row, value: applied[row.key]!, edited: true }
  })
  const existingKeys = new Set(next.map((r) => r.key))
  for (const [key, value] of Object.entries(applied)) {
    if (existingKeys.has(key)) {
      continue
    }
    if (isEnvKeyLocked(key, routePortEnvVars)) {
      continue
    }
    next.push({ key, value, locked: false, edited: true })
    existingKeys.add(key)
  }
  return { rows: next, invalidLines }
}

export function envRowsToUserEnv(rows: EnvRow[]): string {
  return rows
    .filter((row) => !row.locked && row.key.trim() !== '')
    .map((row) => `${row.key}=${row.value}`)
    .join('\n')
}
