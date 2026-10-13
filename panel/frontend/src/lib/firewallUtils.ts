import type { ExposureRow, FirewallRule } from './firewallApi'

export const SSH_DELETE_HELPER =
  'You can remove an SSH allow, except the last one that still lets you in from your current IP.' as const

export const WEB_LOCK_REASON =
  'Web stays open until Cloudflare-only replaces these.' as const

export const CF_LOCK_REASON =
  'Cloudflare address rules stay until you turn the mode off.' as const

export const KEPT_OPEN_LABEL = 'Kept open' as const

export const CF_ONLY_SUMMARY =
  "When on, the site accepts HTTP and HTTPS only from Cloudflare's addresses, so visiting this server's IP on ports 80 and 443 stops working. SSH is unchanged." as const

export const EXPOSURE_GUIDANCE =
  'Public listeners should be SSH (22) and the web server (80 and 443). Anything else listening for the whole internet is marked as a problem.' as const

const INTERNET_WIDE_SOURCES = new Set(['Anywhere', 'Anywhere (v6)', 'any', '0.0.0.0/0', '::/0'])

export function portFromTo(toField: string): string {
  return toField.split('/', 1)[0] ?? toField
}

function rangeIncludesPort(range: string, port: number): boolean {
  if (!range.includes(':')) {
    return Number(range) === port
  }
  const [startS, endS] = range.split(':', 2)
  const start = Number(startS)
  const end = Number(endS)
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return false
  }
  return start <= port && port <= end
}

export function isCloudflareOnlyMode(rules: FirewallRule[]): boolean {
  return rules.some((rule) => rule.comment === 'cf')
}

export function isRuleLocked(rule: FirewallRule, cfOnly: boolean): boolean {
  if (cfOnly) {
    return rule.comment === 'cf'
  }
  if (rule.action !== 'ALLOW IN' || rule.proto !== 'tcp') {
    return false
  }
  const portPart = portFromTo(rule.to)
  return rangeIncludesPort(portPart, 80) || rangeIncludesPort(portPart, 443)
}

export function formatAction(action: string): string {
  if (action === 'ALLOW IN') {
    return 'Allow'
  }
  if (action === 'DENY IN') {
    return 'Deny'
  }
  return action
}

export function formatSource(from: string): string {
  if (INTERNET_WIDE_SOURCES.has(from)) {
    return 'Anyone on the internet'
  }
  return from
}

export function formatFamily(v6: boolean): 'IPv4' | 'IPv6' {
  return v6 ? 'IPv6' : 'IPv4'
}

export function formatProcess(process: string): string {
  switch (process) {
    case 'systemd-resolve':
    case 'systemd-resolved':
      return 'DNS stub'
    case 'docker-proxy':
      return 'Docker'
    case 'sshd':
      return 'SSH'
    case 'nginx':
      return 'Web server'
    default:
      return process
  }
}

export function stripInterfaceScope(address: string): { address: string; scope: string | null } {
  const marker = address.indexOf('%')
  if (marker === -1) {
    return { address, scope: null }
  }
  return { address: address.slice(0, marker), scope: address.slice(marker + 1) }
}

export function isLoopbackAddress(address: string): boolean {
  const bare = stripInterfaceScope(address).address
  return bare === '::1' || bare === 'localhost' || bare.startsWith('127.')
}

export function addressFamily(address: string): 'IPv4' | 'IPv6' {
  const bare = stripInterfaceScope(address).address
  return bare.includes(':') ? 'IPv6' : 'IPv4'
}

export function scopeLabel(address: string): string | null {
  const { scope } = stripInterfaceScope(address)
  if (!scope) {
    return null
  }
  if (scope === 'lo' || isLoopbackAddress(address)) {
    return 'loopback interface'
  }
  return `interface ${scope}`
}

export interface PublicListener {
  key: string
  port: number
  proto: string
  process: string
  reach: string
  expected: boolean
}

export interface LocalListener {
  key: string
  address: string
  scopeLabel: string | null
  port: number
  proto: string
  process: string
  blockedByFirewall: boolean
}

export function splitExposure(rows: ExposureRow[]): {
  publicListeners: PublicListener[]
  localListeners: LocalListener[]
} {
  const groups = new Map<string, { row: ExposureRow; families: Set<'IPv4' | 'IPv6'> }>()
  const localListeners: LocalListener[] = []

  for (const row of rows) {
    if (row.external) {
      const key = `${row.port}-${row.proto}-${row.process}-${row.expected}`
      const family = addressFamily(row.address)
      const existing = groups.get(key)
      if (existing) {
        existing.families.add(family)
      } else {
        groups.set(key, { row, families: new Set([family]) })
      }
      continue
    }

    const { address } = stripInterfaceScope(row.address)
    localListeners.push({
      key: `${row.address}-${row.port}-${row.proto}-${row.process}`,
      address,
      scopeLabel: scopeLabel(row.address),
      port: row.port,
      proto: row.proto,
      process: row.process,
      blockedByFirewall: !isLoopbackAddress(row.address),
    })
  }

  const publicListeners = [...groups.values()].map(({ row, families }) => ({
    key: `${row.port}-${row.proto}-${row.process}-${row.expected}`,
    port: row.port,
    proto: row.proto,
    process: row.process,
    reach:
      families.has('IPv4') && families.has('IPv6')
        ? 'IPv4 and IPv6'
        : families.has('IPv6')
          ? 'IPv6'
          : 'IPv4',
    expected: row.expected,
  }))

  return { publicListeners, localListeners }
}
