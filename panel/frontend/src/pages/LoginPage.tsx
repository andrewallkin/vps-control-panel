import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ApiError, fetchMe, loginRequest } from '../lib/api'
import { authQueryKey } from '../lib/auth'
import {
  hasLoginFieldErrors,
  validateLoginForm,
} from '../lib/loginValidation'
import { isAuthenticated, useAuthMe } from '../hooks/useAuthMe'

type LockoutState = {
  retryAfterSeconds: number
}

function parseLockout(error: ApiError): LockoutState | null {
  if (error.status !== 429) {
    return null
  }
  const body = error.body as { detail?: string; retry_after_seconds?: number }
  if (body?.detail !== 'locked') {
    return null
  }
  const seconds =
    typeof body.retry_after_seconds === 'number'
      ? body.retry_after_seconds
      : 0
  return { retryAfterSeconds: Math.max(0, seconds) }
}

export function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: me, error, isPending } = useAuthMe()
  const authState = isAuthenticated(me, error, isPending)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [lockout, setLockout] = useState<LockoutState | null>(null)

  const lockoutSeconds = lockout?.retryAfterSeconds ?? 0

  useEffect(() => {
    if (lockoutSeconds <= 0) {
      return
    }
    const timer = window.setInterval(() => {
      setLockout((current) => {
        if (!current) {
          return null
        }
        const next = current.retryAfterSeconds - 1
        if (next <= 0) {
          return null
        }
        return { retryAfterSeconds: next }
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [lockoutSeconds])

  const loginMutation = useMutation({
    mutationFn: loginRequest,
    onSuccess: async () => {
      try {
        await queryClient.invalidateQueries({ queryKey: authQueryKey })
        const refreshed = await queryClient.fetchQuery({
          queryKey: authQueryKey,
          queryFn: fetchMe,
        })
        navigate(refreshed.setup_complete ? '/' : '/setup', { replace: true })
      } catch {
        setSubmitError(
          'Sign-in succeeded, but the session could not be established. Your browser may be blocking the session cookie (Safari over http://localhost) — try Chrome or Firefox, or open the panel over HTTPS.',
        )
      }
    },
    onError: (err: unknown) => {
      if (!(err instanceof ApiError)) {
        setSubmitError('Something went wrong. Try again.')
        return
      }
      const lock = parseLockout(err)
      if (lock) {
        setLockout(lock)
        setSubmitError(null)
        return
      }
      if (err.status === 401) {
        const body = err.body as { detail?: string }
        if (body?.detail === 'invalid_credentials') {
          setSubmitError('Invalid credentials.')
          return
        }
      }
      setSubmitError('Something went wrong. Try again.')
    },
  })

  if (authState === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  if (authState === true && me) {
    return <Navigate to={me.setup_complete ? '/' : '/setup'} replace />
  }

  const locked = lockout !== null && lockout.retryAfterSeconds > 0

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (locked || loginMutation.isPending) {
      return
    }
    setSubmitError(null)
    const errors = validateLoginForm({ username, password, code })
    if (hasLoginFieldErrors(errors)) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})
    loginMutation.mutate({
      username: username.trim(),
      password,
      code: code.trim(),
    })
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Username, password, and authenticator code
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
          <div>
            <label htmlFor="username" className="block text-sm font-medium">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-invalid={fieldErrors.username ? true : undefined}
              aria-describedby={fieldErrors.username ? 'username-error' : undefined}
            />
            {fieldErrors.username ? (
              <p id="username-error" className="mt-1 text-sm text-destructive" role="alert">
                {fieldErrors.username}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            />
            {fieldErrors.password ? (
              <p id="password-error" className="mt-1 text-sm text-destructive" role="alert">
                {fieldErrors.password}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="code" className="block text-sm font-medium">
              Authenticator code
            </label>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm tracking-widest text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-invalid={fieldErrors.code ? true : undefined}
              aria-describedby={fieldErrors.code ? 'code-error' : undefined}
            />
            {fieldErrors.code ? (
              <p id="code-error" className="mt-1 text-sm text-destructive" role="alert">
                {fieldErrors.code}
              </p>
            ) : null}
          </div>

          {submitError ? (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          ) : null}

          {locked ? (
            <p className="text-sm text-warning" role="status">
              Too many attempts. Try again in {lockout.retryAfterSeconds} seconds.
            </p>
          ) : null}

          <button
            type="submit"
            disabled={locked || loginMutation.isPending}
            className="inline-flex w-full items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
