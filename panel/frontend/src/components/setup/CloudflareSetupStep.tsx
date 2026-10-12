import { CheckCircle, Spinner } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  fetchCloudflareZones,
  postCloudflareToken,
  updateServerSettings,
  type CloudflareZone,
} from '../../lib/domainsApi'

export interface CloudflareSetupStepProps {
  configured: boolean
  zones: CloudflareZone[]
  zonesLoading?: boolean
  zonesError?: string | null
  acmeEmail?: string
  onTokenSaved: () => void
  onContinue: () => void
}

const ACME_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function CloudflareSetupStep({
  configured,
  zones,
  zonesLoading = false,
  zonesError = null,
  acmeEmail = '',
  onTokenSaved,
  onContinue,
}: CloudflareSetupStepProps) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')
  const [tokenSaved, setTokenSaved] = useState(configured)
  const [error, setError] = useState<string | null>(null)
  const [acmeEmailValue, setAcmeEmailValue] = useState(acmeEmail)
  const [savingEmail, setSavingEmail] = useState(false)

  const emailValid = ACME_EMAIL_RE.test(acmeEmailValue.trim())
  const emailDirty = acmeEmailValue.trim() !== acmeEmail.trim()
  const continueDisabled = zonesLoading || !emailValid || savingEmail

  async function handleContinue() {
    if (emailDirty && emailValid) {
      setSavingEmail(true)
      try {
        await updateServerSettings({ acme_email: acmeEmailValue.trim() })
      } catch {
        setError('Could not save the ACME email.')
        setSavingEmail(false)
        return
      }
      setSavingEmail(false)
    }
    onContinue()
  }

  const showConfigured = configured || tokenSaved

  const mutation = useMutation({
    mutationFn: () => postCloudflareToken(token.trim()),
    onSuccess: async (result) => {
      setError(null)
      setToken('')
      if (result.configured) {
        setTokenSaved(true)
        onTokenSaved()
      }
      await queryClient.invalidateQueries({ queryKey: ['setup', 'state'] })
      await queryClient.fetchQuery({
        queryKey: ['cloudflare', 'zones'],
        queryFn: fetchCloudflareZones,
      })
    },
    onError: () => {
      setError('Could not validate the Cloudflare token.')
    },
  })

  return (
    <section className="space-y-4" aria-labelledby="cloudflare-step-heading">
      <h2 id="cloudflare-step-heading" className="text-base font-semibold">
        Cloudflare
      </h2>
      <p className="text-sm text-muted-foreground">
        Paste an API token with Zone:Read and DNS:Edit for the zones you will use. Zone
        Settings:Read is optional and enables SSL mode warnings on the Domains page.
      </p>

      <div className="space-y-2">
        <label htmlFor="setup-acme-email" className="text-sm font-medium">
          ACME email
        </label>
        <p className="text-xs text-muted-foreground">
          Let's Encrypt expiry and account notices for certificate issuance.
        </p>
        <input
          id="setup-acme-email"
          type="email"
          autoComplete="email"
          value={acmeEmailValue}
          placeholder="ops@example.com"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          onChange={(event) => setAcmeEmailValue(event.target.value)}
        />
        {acmeEmailValue.trim() && !emailValid ? (
          <p className="text-sm text-destructive">Enter a valid email address.</p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      {showConfigured ? (
        <div className="space-y-3">
          <p className="inline-flex items-center gap-2 text-sm text-accent">
            <CheckCircle weight="regular" aria-hidden className="size-4" />
            Token saved
          </p>
          {zonesLoading ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
              Loading zones…
            </p>
          ) : zones.length > 0 ? (
            <ul className="rounded-lg border border-border bg-card divide-y divide-border">
              {zones.map((zone) => (
                <li key={zone.id} className="px-4 py-2 text-sm">
                  <span className="font-medium">{zone.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{zone.status}</span>
                </li>
              ))}
            </ul>
          ) : zonesError ? (
            <p className="text-sm text-destructive">{zonesError}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No zones returned for this token.</p>
          )}
          <button
            type="button"
            disabled={continueDisabled}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleContinue}
          >
            Continue
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <label htmlFor="setup-cf-token" className="text-sm font-medium">
            API token
          </label>
          <input
            id="setup-cf-token"
            type="password"
            autoComplete="off"
            value={token}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            onChange={(event) => setToken(event.target.value)}
          />
          <button
            type="button"
            disabled={!token.trim() || mutation.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50"
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? (
              <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
            ) : null}
            Save token
          </button>
        </div>
      )}
    </section>
  )
}
