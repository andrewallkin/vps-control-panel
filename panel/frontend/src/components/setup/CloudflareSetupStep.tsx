import { CheckCircle } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  fetchCloudflareZones,
  postCloudflareToken,
  updateServerSettings,
  type CloudflareZone,
} from '../../lib/domainsApi'
import { Alert, Button, Card, CardBody, Field, Input, Spinner } from '../ui'

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
  const emailInvalid = acmeEmailValue.trim() !== '' && !emailValid
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
        Paste an API token with Zone:Read, DNS:Edit, and Zone WAF Edit for the zones you will
        use. Zone Settings:Read is optional and enables SSL mode warnings on the Domains page.
      </p>

      <Field
        label="ACME email"
        hint="Let's Encrypt expiry and account notices for certificate issuance."
        error={emailInvalid ? 'Enter a valid email address.' : undefined}
      >
        {(control) => (
          <Input
            {...control}
            type="email"
            autoComplete="email"
            value={acmeEmailValue}
            placeholder="ops@example.com"
            onChange={(event) => setAcmeEmailValue(event.target.value)}
          />
        )}
      </Field>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {showConfigured ? (
        <div className="space-y-3">
          <BadgeRow label="Token saved" />
          {zonesLoading ? (
            <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading zones…
            </p>
          ) : zones.length > 0 ? (
            <Card>
              <CardBody className="divide-y divide-border p-0">
                <ul>
                  {zones.map((zone) => (
                    <li key={zone.id} className="px-4 py-2 text-sm">
                      <span className="font-medium">{zone.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{zone.status}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : zonesError ? (
            <Alert tone="danger">{zonesError}</Alert>
          ) : (
            <p className="text-sm text-muted-foreground">No zones returned for this token.</p>
          )}
          <Button type="button" disabled={continueDisabled} onClick={handleContinue}>
            Continue
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="API token">
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            )}
          </Field>
          <Button
            type="button"
            disabled={!token.trim()}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Save token
          </Button>
        </div>
      )}
    </section>
  )
}

function BadgeRow({ label }: { label: string }) {
  return (
    <p className="inline-flex items-center gap-2 text-sm font-medium text-accent">
      <CheckCircle weight="regular" aria-hidden className="size-4" />
      {label}
    </p>
  )
}