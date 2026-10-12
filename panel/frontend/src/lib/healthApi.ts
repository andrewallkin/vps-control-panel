import { apiJson } from './api'

export interface PanelHealth {
  status: string
  version: string
}

export interface AgentHealth {
  status: string
  version: string
}

export async function fetchPanelHealth(): Promise<PanelHealth> {
  return apiJson<PanelHealth>('/api/health')
}

export async function fetchAgentHealth(): Promise<AgentHealth> {
  return apiJson<AgentHealth>('/api/health/agent')
}
