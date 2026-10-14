import { ApiError, apiFetch, apiJson } from './api'
import type { RuleDraft } from './cloudflareRules'
import type { CloudflareCustomRule } from './cloudflareRules'

export interface CloudflareRulesResponse {
  rules: CloudflareCustomRule[]
  error: 'permission' | null
}

export async function fetchCloudflareRules(domain: string): Promise<CloudflareRulesResponse> {
  const params = new URLSearchParams({ domain })
  return apiJson<CloudflareRulesResponse>(`/api/cloudflare/rules?${params.toString()}`)
}

export async function createCloudflareRule(
  domain: string,
  draft: RuleDraft,
): Promise<CloudflareCustomRule> {
  return apiJson<CloudflareCustomRule>('/api/cloudflare/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, ...draft }),
  })
}

export async function updateCloudflareRule(
  domain: string,
  ruleId: string,
  draft: RuleDraft,
): Promise<CloudflareCustomRule> {
  return apiJson<CloudflareCustomRule>(`/api/cloudflare/rules/${encodeURIComponent(ruleId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, ...draft }),
  })
}

export async function deleteCloudflareRule(domain: string, ruleId: string): Promise<void> {
  const params = new URLSearchParams({ domain })
  const response = await apiFetch(
    `/api/cloudflare/rules/${encodeURIComponent(ruleId)}?${params.toString()}`,
    { method: 'DELETE' },
  )
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new ApiError(response.status, body)
  }
}
