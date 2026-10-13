import { CheckCircle, Spinner, Trash } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { OtpQrCode } from '../components/account/OtpQrCode'
import { StepUpDialog } from '../components/StepUpDialog'
import { ApiError, isStepUpRequired } from '../lib/api'
import {
  changeAccountPassword,
  confirmAccountTotp,
  fetchAccountSessions,
  resetAccountTotp,
  revokeAccountSession,
} from '../lib/accountApi'
import {
  fetchCloudflareZones,
  fetchServerSettings,
  postCloudflareToken,
  updateServerSettings,
} from '../lib/domainsApi'
import { fetchAgentHealth, fetchPanelHealth } from '../lib/healthApi'
import { authQueryKey } from '../lib/auth'
import { formatDateTime } from '../lib/format'
import { fetchRegistryStatus, setRegistryCredentials } from '../lib/registryApi'

type PendingAction =
  | { kind: 'cloudflare-token'; token: string }
  | { kind: 'server-settings'; payload: { public_ipv4?: string; acme_email?: string } }
  | { kind: 'registry'; body: { username: string; token: string } }
  | { kind: 'totp-reset' }
  | null

export function SettingsPage() {
  const queryClient = useQueryClient()
  const [tokenDraft, setTokenDraft] = useState('')
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [stepUpOpen, setStepUpOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [acmeOverride, setAcmeOverride] = useState<string | null>(null)
  const [ipv4Override, setIpv4Override] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordCode, setPasswordCode] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null)

  const [totpPending, setTotpPending] = useState<{ secret: string; otpauth_uri: string } | null>(
    null,
  )
  const [totpConfirmCode, setTotpConfirmCode] = useState('')
  const [totpError, setTotpError] = useState<string | null>(null)
  const [totpSuccess, setTotpSuccess] = useState<string | null>(null)

  const [registryUsername, setRegistryUsername] = useState('')
  const [registryToken, setRegistryToken] = useState('')
  const [registryError, setRegistryError] = useState<string | null>(null)
  const [registrySuccess, setRegistrySuccess] = useState<string | null>(null)

  const zonesQuery = useQuery({
    queryKey: ['cloudflare', 'zones'],
    queryFn: fetchCloudflareZones,
    refetchIntervalInBackground: false,
  })

  const settingsQuery = useQuery({
    queryKey: ['server-settings'],
    queryFn: fetchServerSettings,
    refetchIntervalInBackground: false,
  })

  const registryQuery = useQuery({
    queryKey: ['registry', 'status'],
    queryFn: fetchRegistryStatus,
    refetchIntervalInBackground: false,
  })

  const sessionsQuery = useQuery({
    queryKey: ['account', 'sessions'],
    queryFn: fetchAccountSessions,
    refetchIntervalInBackground: false,
  })

  const panelHealthQuery = useQuery({
    queryKey: ['health', 'panel'],
    queryFn: fetchPanelHealth,
    refetchIntervalInBackground: false,
  })

  const agentHealthQuery = useQuery({
    queryKey: ['health', 'agent'],
    queryFn: fetchAgentHealth,
    refetchIntervalInBackground: false,
  })

  const cloudflareConfigured = zonesQuery.data?.configured === true
  const registryConfigured = registryQuery.data?.configured === true

  const runPending = async (action: PendingAction) => {
    if (!action) {
      return
    }
    setFormError(null)
    setFormSuccess(null)
    setRegistryError(null)
    setTotpError(null)
    try {
      if (action.kind === 'cloudflare-token') {
        await postCloudflareToken(action.token)
        setTokenDraft('')
        setReplaceOpen(false)
        setFormSuccess('Cloudflare token updated.')
        await queryClient.invalidateQueries({ queryKey: ['cloudflare', 'zones'] })
      } else if (action.kind === 'server-settings') {
        await updateServerSettings(action.payload)
        setFormSuccess('Server settings saved.')
        setAcmeOverride(null)
        setIpv4Override(null)
        await queryClient.invalidateQueries({ queryKey: ['server-settings'] })
      } else if (action.kind === 'registry') {
        await setRegistryCredentials(action.body)
        setRegistrySuccess('Docker Hub credentials saved.')
        setRegistryUsername('')
        setRegistryToken('')
        await queryClient.invalidateQueries({ queryKey: ['registry', 'status'] })
      } else if (action.kind === 'totp-reset') {
        const result = await resetAccountTotp()
        setTotpPending(result)
        setTotpConfirmCode('')
        setTotpSuccess('Scan the QR code and confirm with a code from your authenticator.')
      }
      await queryClient.invalidateQueries({ queryKey: authQueryKey })
    } catch (error) {
      if (isStepUpRequired(error)) {
        setPendingAction(action)
        setStepUpOpen(true)
        return
      }
      if (action.kind === 'registry') {
        setRegistryError('Could not save Docker Hub credentials.')
      } else if (action.kind === 'totp-reset') {
        setTotpError('Could not start TOTP reset.')
      } else {
        setFormError('Could not save settings.')
      }
    }
  }

  const tokenMutation = useMutation({
    mutationFn: (token: string) => runPending({ kind: 'cloudflare-token', token }),
  })

  const settingsMutation = useMutation({
    mutationFn: (payload: { public_ipv4?: string; acme_email?: string }) =>
      runPending({ kind: 'server-settings', payload }),
  })

  const registryMutation = useMutation({
    mutationFn: (body: { username: string; token: string }) =>
      runPending({ kind: 'registry', body }),
  })

  const passwordMutation = useMutation({
    mutationFn: () =>
      changeAccountPassword({
        current_password: currentPassword,
        new_password: newPassword,
        code: passwordCode,
      }),
    onSuccess: () => {
      setPasswordSuccess('Password updated.')
      setPasswordError(null)
      setCurrentPassword('')
      setNewPassword('')
      setPasswordCode('')
    },
    onError: (error) => {
      setPasswordSuccess(null)
      if (error instanceof ApiError && error.status === 401) {
        setPasswordError('Current password or authenticator code is incorrect.')
        return
      }
      setPasswordError('Could not change password.')
    },
  })

  const totpConfirmMutation = useMutation({
    mutationFn: () => confirmAccountTotp({ code: totpConfirmCode.trim() }),
    onSuccess: async () => {
      setTotpSuccess('Authenticator updated.')
      setTotpError(null)
      setTotpPending(null)
      setTotpConfirmCode('')
      await queryClient.invalidateQueries({ queryKey: authQueryKey })
    },
    onError: () => {
      setTotpError('Invalid confirmation code.')
    },
  })

  const revokeSessionMutation = useMutation({
    mutationFn: (sessionId: number) => revokeAccountSession(sessionId),
    onSuccess: async (_data, sessionId) => {
      const revokedCurrent = sessionsQuery.data?.some(
        (row) => row.id === sessionId && row.current,
      )
      if (revokedCurrent) {
        window.location.assign('/login')
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['account', 'sessions'] })
    },
    onError: () => {
      setFormError('Could not revoke session.')
    },
  })

  const acmeEmail = acmeOverride ?? settingsQuery.data?.acme_email ?? ''
  const publicIpv4 = ipv4Override ?? settingsQuery.data?.public_ipv4 ?? ''

  const passwordValid =
    currentPassword.length > 0 && newPassword.length >= 12 && passwordCode.trim().length > 0

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Account security, integrations, and server configuration.
        </p>
      </div>

      {formError ? (
        <p className="text-sm text-destructive" role="alert">
          {formError}
        </p>
      ) : null}
      {formSuccess ? (
        <p className="inline-flex items-center gap-2 text-sm text-accent" role="status">
          <CheckCircle weight="regular" aria-hidden className="size-4" />
          {formSuccess}
        </p>
      ) : null}

      <section
        className="space-y-4 rounded-lg border border-border bg-card p-4"
        aria-labelledby="account-settings-heading"
      >
        <h2 id="account-settings-heading" className="text-base font-semibold">
          Account
        </h2>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Password</h3>
          {passwordError ? (
            <p className="text-sm text-destructive" role="alert">
              {passwordError}
            </p>
          ) : null}
          {passwordSuccess ? (
            <p className="inline-flex items-center gap-2 text-sm text-accent" role="status">
              <CheckCircle weight="regular" aria-hidden className="size-4" />
              {passwordSuccess}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="settings-current-password" className="block text-sm font-medium">
                Current password
              </label>
              <input
                id="settings-current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="settings-new-password" className="block text-sm font-medium">
                New password
              </label>
              <input
                id="settings-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="settings-password-code" className="block text-sm font-medium">
              Authenticator code
            </label>
            <input
              id="settings-password-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={passwordCode}
              className="mt-1 w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              onChange={(event) => setPasswordCode(event.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={!passwordValid || passwordMutation.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => passwordMutation.mutate()}
          >
            {passwordMutation.isPending ? (
              <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
            ) : null}
            Change password
          </button>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Authenticator (TOTP)</h3>
          {totpError ? (
            <p className="text-sm text-destructive" role="alert">
              {totpError}
            </p>
          ) : null}
          {totpSuccess && !totpPending ? (
            <p className="inline-flex items-center gap-2 text-sm text-accent" role="status">
              <CheckCircle weight="regular" aria-hidden className="size-4" />
              {totpSuccess}
            </p>
          ) : null}
          {!totpPending ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => {
                setTotpError(null)
                setTotpSuccess(null)
                setPendingAction({ kind: 'totp-reset' })
                setStepUpOpen(true)
              }}
            >
              Reset authenticator
            </button>
          ) : (
            <div className="space-y-3">
              {totpSuccess ? <p className="text-sm text-muted-foreground">{totpSuccess}</p> : null}
              <p className="text-sm">
                Secret:{' '}
                <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-xs">
                  {totpPending.secret}
                </code>
              </p>
              <OtpQrCode uri={totpPending.otpauth_uri} />
              <div className="space-y-1">
                <label htmlFor="settings-totp-confirm" className="block text-sm font-medium">
                  Confirmation code
                </label>
                <input
                  id="settings-totp-confirm"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totpConfirmCode}
                  className="mt-1 w-full max-w-xs rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  onChange={(event) => setTotpConfirmCode(event.target.value)}
                />
              </div>
              <button
                type="button"
                disabled={!totpConfirmCode.trim() || totpConfirmMutation.isPending}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => totpConfirmMutation.mutate()}
              >
                {totpConfirmMutation.isPending ? (
                  <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
                ) : null}
                Confirm new authenticator
              </button>
            </div>
          )}
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Sessions</h3>
          {sessionsQuery.isError ? (
            <p className="text-sm text-destructive" role="alert">
              Could not load sessions.
            </p>
          ) : sessionsQuery.isPending ? (
            <p className="text-sm text-muted-foreground">Loading sessions…</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {(sessionsQuery.data ?? []).length === 0 ? (
                <li className="px-3 py-3 text-sm text-muted-foreground">No sessions yet.</li>
              ) : null}
              {(sessionsQuery.data ?? []).map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-3 py-3 text-sm"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium">
                      {row.ip ?? 'Unknown IP'}
                      {row.current ? (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                          Current
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-muted-foreground">{row.user_agent ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">
                      Last seen {formatDateTime(row.last_seen_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={revokeSessionMutation.isPending}
                    onClick={() => revokeSessionMutation.mutate(row.id)}
                  >
                    <Trash weight="regular" aria-hidden className="size-3.5" />
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-labelledby="cf-settings-heading">
        <h2 id="cf-settings-heading" className="text-base font-semibold">
          Cloudflare API token
        </h2>
        {cloudflareConfigured ? (
          <p className="inline-flex items-center gap-2 text-sm text-foreground">
            <CheckCircle weight="regular" aria-hidden className="size-4 text-accent" />
            Configured
            <span className="font-mono text-muted-foreground">••••••••</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Not configured</p>
        )}
        {!replaceOpen ? (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => {
              setReplaceOpen(true)
              setFormError(null)
            }}
          >
            {cloudflareConfigured ? 'Replace token' : 'Add token'}
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Required permissions: Zone:Read and DNS:Edit for your zones. Zone Settings:Read is
              optional (SSL mode warnings).
            </p>
            <label htmlFor="settings-cf-token" className="block text-sm font-medium">
              API token
            </label>
            <input
              id="settings-cf-token"
              type="password"
              autoComplete="off"
              value={tokenDraft}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              onChange={(event) => setTokenDraft(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => {
                  setReplaceOpen(false)
                  setTokenDraft('')
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!tokenDraft.trim() || tokenMutation.isPending}
                className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => {
                  const token = tokenDraft.trim()
                  if (cloudflareConfigured) {
                    setPendingAction({ kind: 'cloudflare-token', token })
                    setStepUpOpen(true)
                    return
                  }
                  tokenMutation.mutate(token)
                }}
              >
                {tokenMutation.isPending ? (
                  <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
                ) : null}
                Save token
              </button>
            </div>
          </div>
        )}
      </section>

      <section
        className="space-y-3 rounded-lg border border-border bg-card p-4"
        aria-labelledby="registry-settings-heading"
      >
        <h2 id="registry-settings-heading" className="text-base font-semibold">
          Docker Hub
        </h2>
        {registryConfigured ? (
          <p className="inline-flex items-center gap-2 text-sm">
            <CheckCircle weight="regular" aria-hidden className="size-4 text-accent" />
            Configured as{' '}
            <span className="font-mono">{registryQuery.data?.username ?? '—'}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Not configured</p>
        )}
        {registryError ? (
          <p className="text-sm text-destructive" role="alert">
            {registryError}
          </p>
        ) : null}
        {registrySuccess ? (
          <p className="inline-flex items-center gap-2 text-sm text-accent" role="status">
            <CheckCircle weight="regular" aria-hidden className="size-4" />
            {registrySuccess}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="settings-registry-username" className="block text-sm font-medium">
              Username
            </label>
            <input
              id="settings-registry-username"
              type="text"
              autoComplete="username"
              value={registryUsername}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              onChange={(event) => setRegistryUsername(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="settings-registry-token" className="block text-sm font-medium">
              Access token
            </label>
            <input
              id="settings-registry-token"
              type="password"
              autoComplete="new-password"
              value={registryToken}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              onChange={(event) => setRegistryToken(event.target.value)}
            />
          </div>
        </div>
        <button
          type="button"
          disabled={!registryUsername.trim() || !registryToken.trim() || registryMutation.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => {
            const body = { username: registryUsername.trim(), token: registryToken.trim() }
            setPendingAction({ kind: 'registry', body })
            setStepUpOpen(true)
          }}
        >
          {registryMutation.isPending ? (
            <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
          ) : null}
          Save Docker Hub credentials
        </button>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-labelledby="server-settings-heading">
        <h2 id="server-settings-heading" className="text-base font-semibold">
          Server settings
        </h2>
        <div className="space-y-1">
          <label htmlFor="settings-acme-email" className="block text-sm font-medium">
            ACME email
          </label>
          <input
            id="settings-acme-email"
            type="email"
            value={acmeEmail}
            disabled={settingsQuery.isPending}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            onChange={(event) => setAcmeOverride(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="settings-public-ipv4" className="block text-sm font-medium">
            Server public IPv4
          </label>
          <input
            id="settings-public-ipv4"
            type="text"
            inputMode="decimal"
            value={publicIpv4}
            disabled={settingsQuery.isPending}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            onChange={(event) => setIpv4Override(event.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={settingsMutation.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() =>
            settingsMutation.mutate({
              acme_email: acmeEmail.trim(),
              public_ipv4: publicIpv4.trim(),
            })
          }
        >
          {settingsMutation.isPending ? (
            <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
          ) : null}
          Save server settings
        </button>
      </section>

      <section
        className="space-y-3 rounded-lg border border-border bg-card p-4"
        aria-labelledby="about-settings-heading"
      >
        <h2 id="about-settings-heading" className="text-base font-semibold">
          About
        </h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Panel version</dt>
            <dd className="font-mono">
              {panelHealthQuery.data?.version ??
                (panelHealthQuery.isError ? '—' : 'Loading…')}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Agent version</dt>
            <dd className="font-mono">
              {agentHealthQuery.data?.version ??
                (agentHealthQuery.isError ? '—' : 'Loading…')}
            </dd>
          </div>
        </dl>
      </section>

      <StepUpDialog
        key={stepUpOpen ? 'step-up-open' : 'step-up-closed'}
        open={stepUpOpen}
        onCancel={() => {
          setStepUpOpen(false)
          setPendingAction(null)
        }}
        onVerified={() => {
          setStepUpOpen(false)
          const action = pendingAction
          setPendingAction(null)
          void runPending(action)
        }}
      />
    </div>
  )
}
