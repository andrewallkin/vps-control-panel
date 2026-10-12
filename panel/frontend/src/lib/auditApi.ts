import { apiJson } from './api'

export interface AuditEntry {
  time: string
  source: 'agent' | 'panel'
  operation: string
  params: Record<string, unknown>
  ok: boolean
  duration_ms: number
}

export interface AuditFeed {
  entries: AuditEntry[]
  next_cursor: string | null
}

export interface AuditQuery {
  limit?: number
  cursor?: string
  operation?: string
  ok?: boolean
  since?: string
  until?: string
}

export async function fetchAudit(query: AuditQuery = {}): Promise<AuditFeed> {
  const params = new URLSearchParams()
  if (query.limit != null) {
    params.set('limit', String(query.limit))
  }
  if (query.cursor) {
    params.set('cursor', query.cursor)
  }
  if (query.operation?.trim()) {
    params.set('operation', query.operation.trim())
  }
  if (query.ok != null) {
    params.set('ok', query.ok ? 'true' : 'false')
  }
  if (query.since) {
    params.set('since', query.since)
  }
  if (query.until) {
    params.set('until', query.until)
  }
  const qs = params.toString()
  return apiJson<AuditFeed>(`/api/audit${qs ? `?${qs}` : ''}`)
}
