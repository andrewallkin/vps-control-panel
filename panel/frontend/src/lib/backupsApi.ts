import { apiJson } from './api'

export interface BackupSettings {
  bucket: string
  schedule_hours: string
  schedule_minute: number
  timezone: string
  retention_days: number
  credentials_configured: boolean
  client_email: string | null
  archive_passphrase_set: boolean
}

export interface BackupLastRun {
  finished_at?: string
  success?: boolean
  object?: string
  size_bytes?: number
  archive_object?: string | null
  archive_skipped_reason?: string | null
  archive_error?: string | null
  error?: string | null
}

export interface BackupStatus {
  last_run: BackupLastRun | null
  trigger_pending: boolean
  container: string | null
  next_run: string | null
  overdue: boolean
}

export type BackupSettingsPut = {
  bucket: string
  schedule_hours: string
  schedule_minute: number
  timezone: string
  retention_days: number
  service_account?: string
  archive_passphrase?: string
}

export async function fetchBackupSettings(): Promise<BackupSettings> {
  return apiJson<BackupSettings>('/api/backups/settings')
}

export async function updateBackupSettings(body: BackupSettingsPut): Promise<BackupSettings> {
  return apiJson<BackupSettings>('/api/backups/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function testBackupCredentials(body: {
  service_account: string | null
  bucket: string
}): Promise<{ ok: boolean; detail?: string }> {
  return apiJson('/api/backups/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function runBackupNow(): Promise<{ status: string }> {
  return apiJson('/api/backups/run-now', { method: 'POST' })
}

export async function fetchBackupStatus(): Promise<BackupStatus> {
  return apiJson<BackupStatus>('/api/backups/status')
}

export function parseScheduleHours(raw: string): number[] {
  if (!raw.trim()) {
    return []
  }
  return raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23)
    .sort((a, b) => a - b)
}

export function formatScheduleHours(hours: number[]): string {
  return [...new Set(hours)].sort((a, b) => a - b).join(',')
}
