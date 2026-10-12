import { ApiError, apiFetch, apiJson } from './api'

export interface AccountSession {
  id: number
  created_at: string
  last_seen_at: string
  ip: string | null
  user_agent: string | null
  current: boolean
}

export async function changeAccountPassword(body: {
  current_password: string
  new_password: string
  code: string
}): Promise<{ ok: boolean }> {
  return apiJson('/api/account/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function resetAccountTotp(): Promise<{ secret: string; otpauth_uri: string }> {
  return apiJson('/api/account/totp/reset', {
    method: 'POST',
  })
}

export async function confirmAccountTotp(body: { code: string }): Promise<{ ok: boolean }> {
  return apiJson('/api/account/totp/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function fetchAccountSessions(): Promise<AccountSession[]> {
  return apiJson<AccountSession[]>('/api/account/sessions')
}

export async function revokeAccountSession(sessionId: number): Promise<void> {
  const response = await apiFetch(`/api/account/sessions/${sessionId}`, { method: 'DELETE' })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new ApiError(response.status, body)
  }
}
