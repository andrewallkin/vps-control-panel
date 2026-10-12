export const ROUTE_PATH_RE = /^\/[A-Za-z0-9/_-]*$/
export const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/

export interface RouteDraft {
  path_prefix: string
  port_env_var: string
  streaming?: boolean
  websocket?: boolean
  pass_authorization?: boolean
  max_body_mb?: number
  read_timeout_s?: number
  send_timeout_s?: number
}

export type RoutesValidationResult = { ok: true } | { ok: false; error: string }

export function validateRoutePath(path: string): boolean {
  return ROUTE_PATH_RE.test(path)
}

export function validatePortEnvVar(name: string): boolean {
  return ENV_KEY_RE.test(name)
}

export function validateRoutes(routes: RouteDraft[]): RoutesValidationResult {
  if (routes.length < 1) {
    return { ok: false, error: 'At least one route is required.' }
  }
  const paths = new Set<string>()
  for (const route of routes) {
    if (!validateRoutePath(route.path_prefix)) {
      return { ok: false, error: 'Invalid route path prefix.' }
    }
    if (!validatePortEnvVar(route.port_env_var)) {
      return { ok: false, error: 'Invalid port environment variable name.' }
    }
    if (route.streaming && route.websocket) {
      return { ok: false, error: 'A route cannot be both streaming and websocket.' }
    }
    if (paths.has(route.path_prefix)) {
      return { ok: false, error: 'Route paths must be unique.' }
    }
    paths.add(route.path_prefix)
  }
  return { ok: true }
}
