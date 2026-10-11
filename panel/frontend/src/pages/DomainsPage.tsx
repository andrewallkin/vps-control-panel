import { ArrowsClockwise, Plus, Spinner, Trash } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { AddDomainDialog } from '../components/domains/AddDomainDialog'
import { CertStatusBadge } from '../components/domains/CertStatusBadge'
import { RemoveDomainDialog } from '../components/domains/RemoveDomainDialog'
import { SslModeBadge } from '../components/domains/SslModeBadge'
import { LogViewer } from '../components/setup/LogViewer'
import { ApiError } from '../lib/api'
import {
  deleteDomain,
  fetchCloudflareZones,
  fetchDomains,
  reissueDomain,
  registerDomain,
} from '../lib/domainsApi'
import { useTickingNow } from '../hooks/useTickingNow'

export function DomainsPage() {
  const queryClient = useQueryClient()
  const nowMs = useTickingNow(60_000)
  const [addOpen, setAddOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)
  const [issueJobId, setIssueJobId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const zonesQuery = useQuery({
    queryKey: ['cloudflare', 'zones'],
    queryFn: fetchCloudflareZones,
    refetchIntervalInBackground: false,
  })

  const domainsQuery = useQuery({
    queryKey: ['domains'],
    queryFn: fetchDomains,
    refetchIntervalInBackground: false,
    refetchInterval: issueJobId ? 5000 : false,
  })

  const zoneNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const zone of zonesQuery.data?.zones ?? []) {
      map.set(zone.id, zone.name)
    }
    return map
  }, [zonesQuery.data?.zones])

  const registerMutation = useMutation({
    mutationFn: registerDomain,
    onSuccess: (result) => {
      setAddOpen(false)
      setIssueJobId(result.job_id)
      setActionError(null)
      void queryClient.invalidateQueries({ queryKey: ['domains'] })
    },
    onError: () => {
      setActionError('Could not register domain.')
    },
  })

  const reissueMutation = useMutation({
    mutationFn: reissueDomain,
    onSuccess: (result) => {
      setIssueJobId(result.job_id)
      setActionError(null)
      void queryClient.invalidateQueries({ queryKey: ['domains'] })
    },
    onError: () => {
      setActionError('Could not start certificate reissue.')
    },
  })

  const removeMutation = useMutation({
    mutationFn: deleteDomain,
    onSuccess: () => {
      setRemoveTarget(null)
      setActionError(null)
      void queryClient.invalidateQueries({ queryKey: ['domains'] })
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError && error.status === 409) {
        setActionError('This domain is used by the panel hostname. Change the hostname first.')
      } else {
        setActionError('Could not remove domain.')
      }
      setRemoveTarget(null)
    },
  })

  const zones = zonesQuery.data?.zones ?? []
  const canAdd = zonesQuery.data?.configured === true && zones.length > 0

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Domains</h1>
          <p className="text-sm text-muted-foreground">
            Wildcard TLS certificates and Cloudflare SSL mode for registered zones.
          </p>
        </div>
        <button
          type="button"
          disabled={!canAdd}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50"
          onClick={() => setAddOpen(true)}
        >
          <Plus weight="regular" aria-hidden className="size-4" />
          Add domain
        </button>
      </div>

      {!zonesQuery.data?.configured ? (
        <p className="text-sm text-warning">
          Cloudflare is not configured. Add an API token in Settings before registering domains.
        </p>
      ) : null}

      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Domain
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Zone
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Certificate
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                SSL mode
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {domainsQuery.isPending ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-muted-foreground">
                  Loading domains…
                </td>
              </tr>
            ) : null}
            {(domainsQuery.data ?? []).map((row) => (
              <tr key={row.name} className="border-b border-border last:border-b-0">
                <td className="px-4 py-3 font-medium">{row.name}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {zoneNameById.get(row.zone_id) ?? row.zone_id}
                </td>
                <td className="px-4 py-3">
                  <CertStatusBadge
                    certStatus={row.cert_status}
                    certExpiresAt={row.cert_expires_at}
                    nowMs={nowMs}
                  />
                </td>
                <td className="px-4 py-3">
                  <SslModeBadge sslMode={row.ssl_mode} warning={row.warning} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={reissueMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50"
                      onClick={() => reissueMutation.mutate(row.name)}
                    >
                      <ArrowsClockwise weight="regular" aria-hidden className="size-3.5" />
                      Reissue
                    </button>
                    <button
                      type="button"
                      disabled={removeMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50"
                      onClick={() => setRemoveTarget(row.name)}
                    >
                      <Trash weight="regular" aria-hidden className="size-3.5" />
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!domainsQuery.isPending && (domainsQuery.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-muted-foreground">
                  No domains registered yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {issueJobId ? (
        <section className="space-y-2" aria-labelledby="issue-log-heading">
          <h2 id="issue-log-heading" className="text-base font-semibold">
            Certificate issue log
          </h2>
          <LogViewer
            key={issueJobId}
            jobId={issueJobId}
            onEnd={() => {
              void queryClient.invalidateQueries({ queryKey: ['domains'] })
            }}
          />
        </section>
      ) : null}

      {registerMutation.isPending ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
          Registering domain…
        </p>
      ) : null}

      <AddDomainDialog
        key={addOpen ? 'add-domain-open' : 'add-domain-closed'}
        open={addOpen}
        zones={zones}
        busy={registerMutation.isPending}
        onCancel={() => setAddOpen(false)}
        onSubmit={(payload) => registerMutation.mutate(payload)}
      />

      <RemoveDomainDialog
        open={removeTarget !== null}
        domainName={removeTarget}
        busy={removeMutation.isPending}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) {
            removeMutation.mutate(removeTarget)
          }
        }}
      />
    </div>
  )
}
