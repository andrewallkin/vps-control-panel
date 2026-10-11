import { apiFetch, apiJson } from './api'

export type DatabaseStatus = 'pending' | 'empty' | 'restored'

export interface SetupStep {
  id: 'account' | 'database'
  status: string
}

export interface SetupState {
  steps: SetupStep[]
  completed: boolean
}

export interface UploadCompleteInfo {
  id: string
  filename: string
  size: number
  kind: string
  header_ok: boolean
  databases: string[]
  roles: string[]
}

export interface JobEndPayload {
  status: string
  result: {
    databases?: unknown[]
    roles?: string[]
    error_count?: number
    errors?: string[]
  } | null
  error: string | null
}

export async function fetchSetupState(): Promise<SetupState> {
  return apiJson<SetupState>('/api/setup/state')
}

export async function markDatabaseEmpty(): Promise<SetupState> {
  return apiJson<SetupState>('/api/setup/database/empty', { method: 'POST' })
}

export async function createSetupUpload(
  filename: string,
  size: number,
): Promise<{ upload_id: string }> {
  return apiJson('/api/setup/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, size }),
  })
}

export async function putSetupUploadChunk(
  uploadId: string,
  offset: number,
  body: Blob,
  options: { signal?: AbortSignal } = {},
): Promise<{ received: number }> {
  return apiJson(`/api/setup/uploads/${uploadId}?offset=${offset}`, {
    method: 'PUT',
    body,
    signal: options.signal,
  })
}

export async function fetchSetupUploadReceived(
  uploadId: string,
): Promise<{ received: number }> {
  return apiJson(`/api/setup/uploads/${uploadId}`)
}

export async function completeSetupUpload(
  uploadId: string,
  sha256: string,
): Promise<UploadCompleteInfo> {
  return apiJson(`/api/setup/uploads/${uploadId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha256 }),
  })
}

export async function deleteSetupUpload(uploadId: string): Promise<void> {
  const response = await apiFetch(`/api/setup/uploads/${uploadId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    throw new Error(`delete failed: ${response.status} ${JSON.stringify(body)}`)
  }
}

export async function startSetupRestore(
  uploadId: string,
): Promise<{ job_id: string }> {
  return apiJson('/api/setup/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ upload_id: uploadId, confirm: 'RESTORE' }),
  })
}

export async function completeSetup(): Promise<SetupState> {
  return apiJson('/api/setup/complete', { method: 'POST' })
}
