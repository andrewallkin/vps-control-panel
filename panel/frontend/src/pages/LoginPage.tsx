import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Alert, Button, Card, CardBody, Field, Input, ProductLogo } from '../components/ui'
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
      <Card className="w-full max-w-sm shadow-popover">
        <CardBody className="space-y-6 p-6">
          <ProductLogo size="md" showName="below" nameClassName="tracking-tight text-foreground" />

          <div className="space-y-1">
            <h1 className="text-lg font-semibold text-foreground">Sign in</h1>
            <p className="text-sm text-muted-foreground">
              Username, password, and authenticator code
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            <Field label="Username" error={fieldErrors.username}>
              {(control) => (
                <Input
                  {...control}
                  name="username"
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              )}
            </Field>

            <Field label="Password" error={fieldErrors.password}>
              {(control) => (
                <Input
                  {...control}
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>

            <Field label="Authenticator code" error={fieldErrors.code}>
              {(control) => (
                <Input
                  {...control}
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  mono
                  className="tracking-widest"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              )}
            </Field>

            {submitError ? <Alert tone="danger">{submitError}</Alert> : null}

            {locked ? (
              <Alert tone="warning">
                Too many attempts. Try again in {lockout.retryAfterSeconds} seconds.
              </Alert>
            ) : null}

            <Button type="submit" className="w-full" disabled={locked} loading={loginMutation.isPending}>
              {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}