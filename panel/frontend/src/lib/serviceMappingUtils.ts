export interface ServiceMappingRow {
  service_name: string
  image_env_var: string
  tag_prefix: string
}

const SERVICE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/
const IMAGE_ENV_RE = /^DOCKER_IMAGE_[A-Z0-9_]+$/
const TAG_PREFIX_RE = /^[A-Za-z0-9_.-]{1,100}$/

export function isServiceRowEmpty(row: ServiceMappingRow): boolean {
  return (
    row.service_name.trim() === '' &&
    row.image_env_var.trim() === '' &&
    row.tag_prefix.trim() === ''
  )
}

export function tagPrefixFromImageEnvVar(imageEnvVar: string): string {
  if (!IMAGE_ENV_RE.test(imageEnvVar)) {
    return ''
  }
  const raw = imageEnvVar.slice('DOCKER_IMAGE_'.length)
  return raw.toLowerCase().replace(/_/g, '-')
}

export type PreparedServiceRowsResult =
  | { ok: true; rows: ServiceMappingRow[] }
  | { ok: false; error: string }

export function prepareServiceMappingRows(
  rows: ServiceMappingRow[],
): PreparedServiceRowsResult {
  const kept: ServiceMappingRow[] = []
  for (const row of rows) {
    if (isServiceRowEmpty(row)) {
      continue
    }
    const parts = [row.service_name, row.image_env_var, row.tag_prefix].map((v) => v.trim())
    const filled = parts.filter(Boolean).length
    if (filled !== 3) {
      return { ok: false, error: 'Complete every service row or remove it.' }
    }
    const [service_name, image_env_var, tag_prefix] = parts
    if (!SERVICE_NAME_RE.test(service_name)) {
      return { ok: false, error: `Invalid service name: ${service_name}` }
    }
    if (!IMAGE_ENV_RE.test(image_env_var)) {
      return { ok: false, error: `Invalid image env var: ${image_env_var}` }
    }
    if (!TAG_PREFIX_RE.test(tag_prefix)) {
      return { ok: false, error: `Invalid tag prefix: ${tag_prefix}` }
    }
    kept.push({ service_name, image_env_var, tag_prefix })
  }

  const names = kept.map((row) => row.service_name)
  if (new Set(names).size !== names.length) {
    return { ok: false, error: 'Service names must be unique.' }
  }
  const envVars = kept.map((row) => row.image_env_var)
  if (new Set(envVars).size !== envVars.length) {
    return { ok: false, error: 'Image env vars must be unique.' }
  }

  return { ok: true, rows: kept }
}

export function validateServiceMappingRows(rows: ServiceMappingRow[]): boolean {
  return prepareServiceMappingRows(rows).ok
}
