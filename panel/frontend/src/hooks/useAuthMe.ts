import { useQuery } from '@tanstack/react-query'
import { ApiError, fetchMe, setCachedCsrfToken } from '../lib/api'
import { authQueryKey } from '../lib/auth'

async function loadMe() {
  try {
    return await fetchMe()
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setCachedCsrfToken(null)
    }
    throw error
  }
}

export function useAuthMe(enabled = true) {
  return useQuery({
    queryKey: authQueryKey,
    queryFn: loadMe,
    enabled,
    retry: false,
    staleTime: 30_000,
  })
}

export function isAuthenticated(
  data: ReturnType<typeof useAuthMe>['data'],
  error: ReturnType<typeof useAuthMe>['error'],
  isPending: boolean,
): boolean | null {
  if (isPending) {
    return null
  }
  if (error instanceof ApiError && error.status === 401) {
    setCachedCsrfToken(null)
    return false
  }
  return Boolean(data)
}
