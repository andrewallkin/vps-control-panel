import type { FirewallRule } from './firewallApi'

export const SSH_DELETE_HELPER =
  'The server refuses the last rule that still allows port 22 from the current address.' as const

export const LOCK_TOOLTIP_WEB_PORTS =
  'These ports stay open unless Cloudflare-only mode replaces them.' as const

export const LOCK_TOOLTIP_CF_RULES =
  'Cloudflare range rules cannot be deleted individually; turn the mode off to replace them.' as const

export const EXPOSURE_GUIDANCE = 'Expected: only 22, 80, 443 reachable' as const

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
