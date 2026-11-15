import { CheckCircle } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { fetchDomains, setPanelHostname } from '../../lib/domainsApi'
import { getPanelHostnameContinuePending, setPanelHostnameContinuePending } from '../../lib/setupSession'
import { buildFqdn, validateSubdomain } from '../../lib/subdomainValidation'
import { Alert, Button, Card, CardBody, Checkbox, Field, Input, Select } from '../ui'

export interface PanelHostnameSetupStepProps {
  onSaved: () => void
  onContinue: () => void
}

export function PanelHostnameSetupStep({ onSaved, onContinue }: PanelHostnameSetupStepProps) {
  const queryClient = useQueryClient()
  const domainsQuery = useQuery({
    queryKey: ['domains'],
    queryFn: fetchDomains,
    refetchIntervalInBackground: false,
  })

  const [domain, setDomain] = useState('')
  const [useRoot, setUseRoot] = useState(true)
  const [subdomain, setSubdomain] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [savedHostname, setSavedHostname] = useState<string | null>(() =>
    getPanelHostnameContinuePending(),
  )
  const [error, setError] = useState<string | null>(null)

  const domainOptions = useMemo(
    () => (domainsQuery.data ?? []).map((row) => row.name),
    [domainsQuery.data],
  )

  const effectiveDomain = domain || domainOptions[0] || ''
  const normalizedSubdomain = useRoot ? '' : subdomain
  const preview = effectiveDomain
    ? `https://${buildFqdn(effectiveDomain, normalizedSubdomain.trim().toLowerCase())}`
    : 'https://'

  const mutation = useMutation({
    mutationFn: () => {
      const check = validateSubdomain(normalizedSubdomain)
      if (!check.ok) {
        throw new Error(check.error)
      }
      return setPanelHostname({
        domain: effectiveDomain,
        subdomain: check.normalized,
      })
    },
    onSuccess: async (result) => {
      setSavedHostname(result.panel_hostname)
      setPanelHostnameContinuePending(result.panel_hostname)
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['setup', 'state'] })
      onSaved()
    },
    onError: (err: unknown) => {
      if (err instanceof Error && err.message) {
        setFieldError(err.message)
        return
      }
      setError('Could not configure panel hostname.')
    },
  })

  return (
    <section className="space-y-4" aria-labelledby="panel-hostname-step-heading">
      <h2 id="panel-hostname-step-heading" className="text-xl font-semibold tracking-tight text-foreground">
        Panel hostname
      </h2>
      <p className="text-base text-muted-foreground">
        Choose the public URL for this control panel. DNS and nginx are updated automatically.
      </p>

      {savedHostname ? (
        <Card>
          <CardBody className="space-y-2">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-accent">
              <CheckCircle weight="regular" aria-hidden className="size-4" />
              Panel URL
            </p>
            <p className="break-all font-mono text-sm">
              https://{savedHostname}
            </p>
            <p className="text-sm text-muted-foreground">
              Add Cloudflare Access on this hostname to restrict who can reach the panel.
            </p>
            <Button type="button" onClick={onContinue}>
              Continue
            </Button>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          <Field label="Domain">
            {(control) => (
              <Select
                {...control}
                id="panel-hostname-domain"
                value={effectiveDomain}
                disabled={domainOptions.length === 0}
                onChange={(event) => setDomain(event.target.value)}
              >
                {domainOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={useRoot} onChange={(event) => setUseRoot(event.target.checked)} />
            Root (apex)
          </label>

          {!useRoot ? (
            <Field label="Subdomain label" error={fieldError ?? undefined}>
              {(control) => (
                <Input
                  {...control}
                  id="panel-hostname-subdomain"
                  type="text"
                  value={subdomain}
                  autoComplete="off"
                  onChange={(event) => {
                    setSubdomain(event.target.value)
                    setFieldError(null)
                  }}
                />
              )}
            </Field>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Preview:{' '}
            <span className="break-all font-mono text-foreground">{preview}</span>
          </p>

          {error ? <Alert tone="danger">{error}</Alert> : null}

          <Button
            type="button"
            disabled={!effectiveDomain}
            loading={mutation.isPending}
            onClick={() => {
              setFieldError(null)
              const check = validateSubdomain(normalizedSubdomain)
              if (!check.ok) {
                setFieldError(check.error)
                return
              }
              mutation.mutate()
            }}
          >
            Save hostname
          </Button>
        </div>
      )}
    </section>
  )
}