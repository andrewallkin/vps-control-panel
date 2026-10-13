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
  fetchPanelHostname,
  reissueDomain,
  registerDomain,
  type DomainHostname,
} from '../lib/domainsApi'
import { useTickingNow } from '../hooks/useTickingNow'

function hostnameLabel(entry: DomainHostname): string {
  switch (entry.kind) {
    case 'zone':
      return 'Zone'
    case 'panel':
      return 'Panel'
    case 'primary':
      return entry.project_name ?? entry.project_slug ?? 'Project'
    case 'alias':
      return `${entry.project_name ?? entry.project_slug ?? 'Project'} alias`
    case 'redirect':
      return `${entry.project_name ?? entry.project_slug ?? 'Project'} redirect`
  }
}

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

  const panelHostnameQuery = useQuery({
    queryKey: ['panel-hostname'],
    queryFn: fetchPanelHostname,
    refetchIntervalInBackground: false,
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

  const panelHostname = panelHostnameQuery.data?.panel_hostname ?? null
  const panelHostnameReady = !panelHostnameQuery.isPending
  const domains = domainsQuery.data ?? []
  const panelHostnameListed =
    panelHostnameReady &&
    panelHostname !== null &&
    domains.some((row) => row.hostnames.some((h) => h.fqdn === panelHostname))
  const tableLoading = domainsQuery.isPending || panelHostnameQuery.isPending

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Domains</h1>
          <p className="text-sm text-muted-foreground">
            One wildcard certificate and one Cloudflare SSL mode cover every name in each
            registered zone.
          </p>
        </div>
        <button
          type="button"
          disabled={!canAdd}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => setAddOpen(true)}
        >
          <Plus weight="regular" aria-hidden className="size-4" />
          Add domain
        </button>
      </div>

      {!zonesQuery.data?.configured ? (
        <div className="rounded-lg border border-warning/50 bg-warning/10 px-4 py-3">
          <p className="text-sm text-warning">
            Cloudflare is not configured. Add an API token in Settings before registering domains.
          </p>
        </div>
      ) : null}

      {actionError ? (
        <p className="text-sm text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}

      {zonesQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Could not load Cloudflare zones.
        </p>
      ) : null}

      {domainsQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Could not load domains.
        </p>
      ) : null}

      {panelHostnameQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">
          Could not load panel hostname.
        </p>
      ) : null}

      {panelHostnameReady && panelHostname && !panelHostnameListed ? (
        <p className="text-sm text-muted-foreground">
          <span>Panel hostname </span>
          <span className="font-mono">{panelHostname}</span>
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Names
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Zone
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Certificate
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                SSL mode
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {tableLoading ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-sm text-muted-foreground">
                  Loading domains…
                </td>
              </tr>
            ) : null}
            {!tableLoading
              ? domains.map((row) => (
              <tr key={row.name}>
                <td className="px-3 py-2">
                  <div className="flex flex-col gap-1">
                    {(row.hostnames ?? [
                      {
                        fqdn: row.name,
                        kind: 'zone' as const,
                        project_slug: null,
                        project_name: null,
                      },
                    ]).map((entry) => (
                      <div key={entry.fqdn} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-mono text-sm">{entry.fqdn}</span>
                        <span className="text-xs text-muted-foreground">
                          {hostnameLabel(entry)}
                        </span>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {zoneNameById.get(row.zone_id) ?? row.zone_id}
                </td>
                <td className="px-3 py-2">
                  <CertStatusBadge
                    certStatus={row.cert_status}
                    certExpiresAt={row.cert_expires_at}
                    nowMs={nowMs}
                  />
                </td>
                <td className="px-3 py-2">
                  <SslModeBadge
                    sslMode={row.ssl_mode}
                    sslModeError={row.ssl_mode_error ?? null}
                    warning={row.warning}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={reissueMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => reissueMutation.mutate(row.name)}
                    >
                      <ArrowsClockwise weight="regular" aria-hidden className="size-4" />
                      Reissue
                    </button>
                    <button
                      type="button"
                      disabled={removeMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors duration-200 hover:bg-destructive/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => setRemoveTarget(row.name)}
                    >
                      <Trash weight="regular" aria-hidden className="size-4" />
                      Remove
                    </button>
                  </div>
                </td>
              </tr>
            ))
              : null}
            {!tableLoading && !domainsQuery.isError && domains.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-sm text-muted-foreground">
                  No domains registered yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {issueJobId ? (
        <section className="space-y-3" aria-labelledby="issue-log-heading">
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
