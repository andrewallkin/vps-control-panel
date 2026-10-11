let cachedCsrfToken: string | null = null

export function setCachedCsrfToken(token: string | null): void {
  cachedCsrfToken = token
}

export function getCachedCsrfToken(): string | null {
  return cachedCsrfToken
}

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(`API error ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

function shouldRedirectOn401(path: string): boolean {
  return path !== '/api/auth/login'
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers)

  if (method !== 'GET' && cachedCsrfToken) {
    headers.set('X-CSRF-Token', cachedCsrfToken)
  }

  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers,
  })

  if (response.status === 401 && shouldRedirectOn401(path)) {
    const loginPath = '/login'
    if (window.location.pathname !== loginPath) {
      window.location.assign(loginPath)
    }
  }

  return response
}

export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await apiFetch(path, init)
  const body: unknown = response.ok
    ? await response.json()
    : await response.json().catch(() => null)

  if (!response.ok) {
    throw new ApiError(response.status, body)
  }

  return body as T
}

export interface MeResponse {
  username: string
  csrf_token: string
  stepped_up_until: string | null
  setup_complete: boolean
}

export interface LoginResponse {
  username: string
  csrf_token: string
}

export async function fetchMe(): Promise<MeResponse> {
  const data = await apiJson<MeResponse>('/api/auth/me')
  setCachedCsrfToken(data.csrf_token)
  return data
}

export async function loginRequest(payload: {
  username: string
  password: string
  code: string
}): Promise<LoginResponse> {
  const data = await apiJson<LoginResponse>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  setCachedCsrfToken(data.csrf_token)
  return data
}

export async function stepUpRequest(code: string): Promise<{ stepped_up_until: string | null }> {
  return apiJson('/api/auth/step-up', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
}

export function isStepUpRequired(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 403) {
    return false
  }
  const body = error.body as { detail?: string } | null
  return body?.detail === 'step_up_required'
}
