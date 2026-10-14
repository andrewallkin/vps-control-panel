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

function hostnameType(zoneName: string, fqdn: string): 'Domain' | 'Subdomain' {
  return fqdn === zoneName ? 'Domain' : 'Subdomain'
}

function hostnameUse(entry: DomainHostname): string {
  switch (entry.kind) {
    case 'zone':
      return 'Apex'
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

function zoneHostnames(row: { name: string; hostnames?: DomainHostname[] }): DomainHostname[] {
  if (row.hostnames && row.hostnames.length > 0) {
    return row.hostnames
  }
  return [
    {
      fqdn: row.name,
      kind: 'zone',
      project_slug: null,
      project_name: null,
    },
  ]
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
    domains.some((row) => zoneHostnames(row).some((h) => h.fqdn === panelHostname))
  const tableLoading = domainsQuery.isPending || panelHostnameQuery.isPending

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Domains</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            One wildcard certificate and one Cloudflare SSL mode cover every name in each
            registered zone.
          </p>
        </div>
        <button
          type="button"
          disabled={!canAdd}
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed lg:self-auto"
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
        <p className="max-w-3xl text-sm text-muted-foreground">
          <span>Panel hostname </span>
          <span className="font-mono">{panelHostname}</span>
        </p>
      ) : null}

      {tableLoading ? (
        <div className="rounded-lg border border-border bg-card px-3 py-6 text-sm text-muted-foreground">
          Loading domains…
        </div>
      ) : null}
      {!tableLoading && !domainsQuery.isError && domains.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-3 py-6 text-sm text-muted-foreground">
          No domains registered yet.
        </div>
      ) : null}
      {!tableLoading
        ? domains.map((row) => {
            const names = zoneHostnames(row)
            const zoneName = zoneNameById.get(row.zone_id) ?? row.zone_id
            return (
              <section key={row.name} className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Zone</p>
                    <h2 className="truncate font-mono text-base font-semibold">{zoneName}</h2>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={reissueMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-200 hover:bg-muted cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => reissueMutation.mutate(row.name)}
                    >
                      <ArrowsClockwise weight="regular" aria-hidden className="size-4" />
                      Reissue
                    </button>
                    <button
                      type="button"
                      disabled={removeMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-3 py-2 text-sm font-medium whitespace-nowrap text-destructive transition-colors duration-200 hover:bg-destructive/10 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => setRemoveTarget(row.name)}
                    >
                      <Trash weight="regular" aria-hidden className="size-4" />
                      Remove
                    </button>
                  </div>
                </div>
                <dl className="grid divide-y divide-border border-b border-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                  <div className="flex items-start justify-between gap-4 px-4 py-3">
                    <dt className="text-sm text-muted-foreground">Certificate</dt>
                    <dd className="text-right">
                      <CertStatusBadge
                        certStatus={row.cert_status}
                        certExpiresAt={row.cert_expires_at}
                        nowMs={nowMs}
                      />
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-4 px-4 py-3">
                    <dt className="text-sm text-muted-foreground">SSL mode</dt>
                    <dd className="min-w-0 text-right">
                      <SslModeBadge
                        sslMode={row.ssl_mode}
                        sslModeError={row.ssl_mode_error ?? null}
                        warning={row.warning}
                      />
                    </dd>
                  </div>
                </dl>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-left text-sm">
                    <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                      <tr>
                        <th scope="col" className="min-w-0 px-3 py-2 font-medium">
                          Name
                        </th>
                        <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                          Type
                        </th>
                        <th scope="col" className="min-w-0 px-3 py-2 font-medium">
                          Use
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {names.map((entry) => (
                        <tr key={entry.fqdn}>
                          <td className="min-w-0 px-3 py-2 font-mono text-sm break-all">{entry.fqdn}</td>
                          <td className="whitespace-nowrap px-3 py-2">
                            {hostnameType(row.name, entry.fqdn)}
                          </td>
                          <td className="min-w-0 px-3 py-2 text-muted-foreground">{hostnameUse(entry)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )
          })
        : null}

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
