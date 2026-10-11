import { CheckCircle, Spinner } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { StepUpDialog } from '../components/StepUpDialog'
import { isStepUpRequired } from '../lib/api'
import {
  fetchCloudflareZones,
  fetchServerSettings,
  postCloudflareToken,
  updateServerSettings,
} from '../lib/domainsApi'
import { authQueryKey } from '../lib/auth'

type PendingAction =
  | { kind: 'cloudflare-token'; token: string }
  | { kind: 'server-settings'; payload: { public_ipv4?: string; acme_email?: string } }
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

  const cloudflareConfigured = zonesQuery.data?.configured === true

  const runPending = async (action: PendingAction) => {
    if (!action) {
      return
    }
    setFormError(null)
    setFormSuccess(null)
    try {
      if (action.kind === 'cloudflare-token') {
        await postCloudflareToken(action.token)
        setTokenDraft('')
        setReplaceOpen(false)
        setFormSuccess('Cloudflare token updated.')
        await queryClient.invalidateQueries({ queryKey: ['cloudflare', 'zones'] })
      } else {
        await updateServerSettings(action.payload)
        setFormSuccess('Server settings saved.')
        setAcmeOverride(null)
        setIpv4Override(null)
        await queryClient.invalidateQueries({ queryKey: ['server-settings'] })
      }
      await queryClient.invalidateQueries({ queryKey: authQueryKey })
    } catch (error) {
      if (isStepUpRequired(error)) {
        setPendingAction(action)
        setStepUpOpen(true)
        return
      }
      setFormError('Could not save settings.')
    }
  }

  const tokenMutation = useMutation({
    mutationFn: (token: string) => runPending({ kind: 'cloudflare-token', token }),
  })

  const settingsMutation = useMutation({
    mutationFn: (payload: { public_ipv4?: string; acme_email?: string }) =>
      runPending({ kind: 'server-settings', payload }),
  })

  const acmeEmail = acmeOverride ?? settingsQuery.data?.acme_email ?? ''
  const publicIpv4 = ipv4Override ?? settingsQuery.data?.public_ipv4 ?? ''

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Cloudflare credentials and server values used for DNS and ACME.
        </p>
      </div>

      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
      {formSuccess ? (
        <p className="inline-flex items-center gap-2 text-sm text-accent">
          <CheckCircle weight="regular" aria-hidden className="size-4" />
          {formSuccess}
        </p>
      ) : null}

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
            className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer"
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
            <label htmlFor="settings-cf-token" className="text-sm font-medium">
              API token
            </label>
            <input
              id="settings-cf-token"
              type="password"
              autoComplete="off"
              value={tokenDraft}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              onChange={(event) => setTokenDraft(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer"
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
                className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50"
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

      <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-labelledby="server-settings-heading">
        <h2 id="server-settings-heading" className="text-base font-semibold">
          Server settings
        </h2>
        <div className="space-y-2">
          <label htmlFor="settings-acme-email" className="text-sm font-medium">
            ACME email
          </label>
          <input
            id="settings-acme-email"
            type="email"
            value={acmeEmail}
            disabled={settingsQuery.isPending}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            onChange={(event) => setAcmeOverride(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="settings-public-ipv4" className="text-sm font-medium">
            Server public IPv4
          </label>
          <input
            id="settings-public-ipv4"
            type="text"
            inputMode="decimal"
            value={publicIpv4}
            disabled={settingsQuery.isPending}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
            onChange={(event) => setIpv4Override(event.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={settingsMutation.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50"
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
