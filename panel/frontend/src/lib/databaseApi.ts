import { apiJson } from './api'

export interface DatabaseRow {
  name: string
  owner: string
  size_bytes: number
  attached_slug: string | null
}

export interface DatabaseDumpRow {
  name: string
  size_bytes: number
  created_at: string
}

export interface AdoptDatabasePayload {
  slug: string
  db_name: string
  db_user: string
  password_mode: 'rotate' | 'keep'
  password?: string | null
  write_database_url: boolean
}

export interface DropDatabasePayload {
  db_name: string
  confirm: string
  drop_role: boolean
}

export async function fetchDatabases(): Promise<DatabaseRow[]> {
  return apiJson<DatabaseRow[]>('/api/database/databases')
}

export async function adoptDatabase(
  payload: AdoptDatabasePayload,
): Promise<{ restart_required: boolean }> {
  return apiJson('/api/database/adopt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function rotateDatabasePassword(
  slug: string,
): Promise<{ restart_required: boolean }> {
  return apiJson('/api/database/rotate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  })
}

export async function dropDatabase(payload: DropDatabasePayload): Promise<void> {
  await apiJson('/api/database/drop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function fetchDatabaseDumps(slug: string): Promise<DatabaseDumpRow[]> {
  return apiJson<DatabaseDumpRow[]>(
    `/api/database/dumps/${encodeURIComponent(slug)}`,
  )
}

export function databaseDumpDownloadUrl(slug: string, name: string): string {
  return `/api/database/dumps/${encodeURIComponent(slug)}/${encodeURIComponent(name)}`
}
