import { ApiError, apiFetch, apiJson } from './api'

export interface FirewallRule {
  number: number
  to: string
  proto: string
  action: string
  from: string
  v6: boolean
  comment: string
}

export interface ExposureRow {
  address: string
  port: number
  process: string
  proto: string
  external: boolean
  expected: boolean
}

export interface AddFirewallRulePayload {
  port: number | string
  proto: 'tcp' | 'udp'
  action: 'allow' | 'deny'
  source: string
  comment: string
}

export async function fetchFirewallRules(): Promise<FirewallRule[]> {
  return apiJson<FirewallRule[]>('/api/firewall/rules')
}

export async function fetchFirewallExposure(): Promise<ExposureRow[]> {
  return apiJson<ExposureRow[]>('/api/firewall/exposure')
}

export async function addFirewallRule(payload: AddFirewallRulePayload): Promise<{ status: string }> {
  return apiJson('/api/firewall/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function deleteFirewallRule(
  number: number,
  identity: Omit<FirewallRule, 'number'>,
): Promise<void> {
  const response = await apiFetch(`/api/firewall/rules/${number}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: identity.to,
      proto: identity.proto,
      action: identity.action,
      from: identity.from,
      v6: identity.v6,
      comment: identity.comment,
    }),
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new ApiError(response.status, body)
  }
}

export async function setCloudflareOnly(on: boolean): Promise<{ status: string }> {
  return apiJson('/api/firewall/cloudflare-only', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on }),
  })
}
