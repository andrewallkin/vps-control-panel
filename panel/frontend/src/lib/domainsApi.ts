import { ApiError, apiFetch, apiJson } from './api'

export interface CloudflareZone {
  id: string
  name: string
  status: string
}

export interface CloudflareZonesResponse {
  configured: boolean
  zones: CloudflareZone[]
}

export interface DomainRow {
  name: string
  zone_id: string
  cert_status: string
  cert_expires_at: string | null
  ssl_mode: string | null
  warning: string | null
}

export interface ServerSettings {
  public_ipv4: string
  acme_email: string
}

export const SSL_MODE_WARNING =
  'Set SSL/TLS mode to Full (strict) in Cloudflare.' as const

export async function fetchCloudflareZones(): Promise<CloudflareZonesResponse> {
  return apiJson<CloudflareZonesResponse>('/api/cloudflare/zones')
}

export async function postCloudflareToken(
  token: string,
): Promise<CloudflareZonesResponse> {
  return apiJson<CloudflareZonesResponse>('/api/cloudflare/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })
}

export async function fetchDomains(): Promise<DomainRow[]> {
  return apiJson<DomainRow[]>('/api/domains')
}

export async function registerDomain(payload: {
  name: string
  zone_id: string
}): Promise<{ job_id: string | null; issue_error: string | null }> {
  return apiJson('/api/domains', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function deleteDomain(name: string): Promise<void> {
  const response = await apiFetch(`/api/domains/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new ApiError(response.status, body)
  }
}

export async function reissueDomain(name: string): Promise<{ job_id: string }> {
  return apiJson(`/api/domains/${encodeURIComponent(name)}/reissue`, {
    method: 'POST',
  })
}

export async function fetchServerSettings(): Promise<ServerSettings> {
  return apiJson<ServerSettings>('/api/server-settings')
}

export async function updateServerSettings(
  payload: Partial<ServerSettings>,
): Promise<ServerSettings> {
  return apiJson<ServerSettings>('/api/server-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function fetchPanelHostname(): Promise<{ panel_hostname: string | null }> {
  return apiJson<{ panel_hostname: string | null }>('/api/panel-hostname')
}

export async function setPanelHostname(payload: {
  domain: string
  subdomain: string
}): Promise<{ panel_hostname: string }> {
  return apiJson('/api/panel-hostname', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/** True when hostname is the zone apex or exactly one label under the zone. */
export function panelHostnameUsesDomain(panelHostname: string, domain: string): boolean {
  if (panelHostname === domain) {
    return true
  }
  const suffix = `.${domain}`
  if (!panelHostname.endsWith(suffix)) {
    return false
  }
  const label = panelHostname.slice(0, -suffix.length)
  return !label.includes('.')
}

export function certDaysLeft(expiresAt: string | null, nowMs: number): number | null {
  if (!expiresAt) {
    return null
  }
  const end = Date.parse(expiresAt)
  if (!Number.isFinite(end)) {
    return null
  }
  return Math.ceil((end - nowMs) / 86_400_000)
}

export function certStatusLabel(status: string, daysLeft: number | null): string {
  if (status === 'valid' && daysLeft !== null) {
    return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
  }
  if (status === 'valid') {
    return 'Valid'
  }
  if (status === 'missing') {
    return 'Missing'
  }
  return status
}

export function certStatusVariant(
  status: string,
  daysLeft: number | null,
): 'healthy' | 'warning' | 'critical' {
  if (status !== 'valid') {
    return 'critical'
  }
  if (daysLeft !== null && daysLeft < 14) {
    return 'warning'
  }
  return 'healthy'
}
