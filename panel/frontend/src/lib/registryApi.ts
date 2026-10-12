import { apiJson } from './api'

export interface RegistryStatus {
  configured: boolean
  username?: string
}

export async function fetchRegistryStatus(): Promise<RegistryStatus> {
  return apiJson<RegistryStatus>('/api/settings/registry')
}

export async function setRegistryCredentials(body: {
  username: string
  token: string
}): Promise<{ ok?: boolean }> {
  return apiJson('/api/settings/registry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
