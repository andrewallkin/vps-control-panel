import { CheckCircle, Spinner } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { fetchDomains, setPanelHostname } from '../../lib/domainsApi'
import { buildFqdn, validateSubdomain } from '../../lib/subdomainValidation'

export interface PanelHostnameSetupStepProps {
  onSaved: (hostname: string) => void
}

export function PanelHostnameSetupStep({ onSaved }: PanelHostnameSetupStepProps) {
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
  const [savedHostname, setSavedHostname] = useState<string | null>(null)
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
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['setup', 'state'] })
      onSaved(result.panel_hostname)
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
      <h2 id="panel-hostname-step-heading" className="text-base font-semibold">
        Panel hostname
      </h2>
      <p className="text-sm text-muted-foreground">
        Choose the public URL for this control panel. DNS and nginx are updated automatically.
      </p>

      {savedHostname ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <p className="inline-flex items-center gap-2 text-sm text-accent">
            <CheckCircle weight="regular" aria-hidden className="size-4" />
            Panel URL
          </p>
          <p className="font-mono text-sm break-all">
            https://{savedHostname}
          </p>
          <p className="text-sm text-muted-foreground">
            Add Cloudflare Access on this hostname to restrict who can reach the panel.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="panel-hostname-domain" className="text-sm font-medium">
              Domain
            </label>
            <select
              id="panel-hostname-domain"
              value={effectiveDomain}
              disabled={domainOptions.length === 0}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              onChange={(event) => setDomain(event.target.value)}
            >
              {domainOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={useRoot}
                className="size-4 rounded border-border"
                onChange={(event) => setUseRoot(event.target.checked)}
              />
              Root (apex)
            </label>
          </div>

          {!useRoot ? (
            <div className="space-y-2">
              <label htmlFor="panel-hostname-subdomain" className="text-sm font-medium">
                Subdomain label
              </label>
              <input
                id="panel-hostname-subdomain"
                type="text"
                value={subdomain}
                autoComplete="off"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                onChange={(event) => {
                  setSubdomain(event.target.value)
                  setFieldError(null)
                }}
              />
              {fieldError ? <p className="text-sm text-destructive">{fieldError}</p> : null}
            </div>
          ) : null}

          <p className="text-sm text-muted-foreground">
            Preview:{' '}
            <span className="font-mono text-foreground break-all">{preview}</span>
          </p>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <button
            type="button"
            disabled={!effectiveDomain || mutation.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50"
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
            {mutation.isPending ? (
              <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
            ) : null}
            Save hostname
          </button>
        </div>
      )}
    </section>
  )
}
