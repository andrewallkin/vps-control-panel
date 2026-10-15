export interface PortDraft {
  env_var: string
  default: number | null
  host_port: string
  service?: string | null
}

export interface UsedPortRow {
  port: number
  owner: string | null
  env_var: string | null
}

export interface PortDraftsValidation {
  ok: boolean
  error: string | null
}

export function parsePortDraft(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    return null
  }
  const port = Number(trimmed)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null
  }
  return port
}

export function validatePortDrafts(
  drafts: PortDraft[],
  usedPorts: UsedPortRow[],
  selfSlug: string | null,
): PortDraftsValidation {
  for (const draft of drafts) {
    const port = parsePortDraft(draft.host_port)
    if (port === null) {
      return { ok: false, error: `${draft.env_var}: enter a port between 1 and 65535` }
    }
  }

  const seen = new Map<number, string>()
  for (const draft of drafts) {
    const port = parsePortDraft(draft.host_port)
    if (port === null) {
      continue
    }
    const previous = seen.get(port)
    if (previous !== undefined) {
      return {
        ok: false,
        error: `${previous} and ${draft.env_var} both use port ${port}`,
      }
    }
    seen.set(port, draft.env_var)
  }

  for (const draft of drafts) {
    const port = parsePortDraft(draft.host_port)
    if (port === null) {
      continue
    }
    const holder = usedPorts.find((row) => row.port === port)
    if (holder === undefined) {
      continue
    }
    if (holder.owner === selfSlug && holder.env_var === draft.env_var) {
      continue
    }
    if (holder.owner !== null && holder.env_var !== null) {
      return {
        ok: false,
        error: `Port ${port} is used by ${holder.owner} (${holder.env_var})`,
      }
    }
    return { ok: false, error: `Port ${port} is already in use on this server` }
  }

  return { ok: true, error: null }
}
