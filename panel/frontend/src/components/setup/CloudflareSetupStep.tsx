import { CheckCircle, Spinner } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { postCloudflareToken, type CloudflareZone } from '../../lib/domainsApi'

export interface CloudflareSetupStepProps {
  configured: boolean
  zones: CloudflareZone[]
  onConfigured: () => void
}

export function CloudflareSetupStep({
  configured,
  zones,
  onConfigured,
}: CloudflareSetupStepProps) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => postCloudflareToken(token.trim()),
    onSuccess: async (result) => {
      setError(null)
      setToken('')
      await queryClient.invalidateQueries({ queryKey: ['setup', 'state'] })
      await queryClient.invalidateQueries({ queryKey: ['cloudflare', 'zones'] })
      if (result.configured) {
        onConfigured()
      }
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

      {configured ? (
        <div className="space-y-3">
          <p className="inline-flex items-center gap-2 text-sm text-accent">
            <CheckCircle weight="regular" aria-hidden className="size-4" />
            Token saved
          </p>
          {zones.length > 0 ? (
            <ul className="rounded-lg border border-border bg-card divide-y divide-border">
              {zones.map((zone) => (
                <li key={zone.id} className="px-4 py-2 text-sm">
                  <span className="font-medium">{zone.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{zone.status}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No zones returned for this token.</p>
          )}
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
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
