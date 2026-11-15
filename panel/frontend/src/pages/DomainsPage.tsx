import { ArrowsClockwise, Globe, Plus, Trash } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { AddDomainDialog } from '../components/domains/AddDomainDialog'
import { CertStatusBadge } from '../components/domains/CertStatusBadge'
import { RemoveDomainDialog } from '../components/domains/RemoveDomainDialog'
import { SslModeBadge } from '../components/domains/SslModeBadge'
import { LogViewer } from '../components/setup/LogViewer'
import {
  Alert,
  Button,
  Card,
  CardBody,
  EmptyState,
  PageHeader,
  Skeleton,
  Spinner,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '../components/ui'
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
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const nowMs = useTickingNow(60_000)
  const [addOpen, setAddOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)
  const [issueJobId, setIssueJobId] = useState<string | null>(null)
  const [issueJobRunning, setIssueJobRunning] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)
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
    refetchInterval: issueJobRunning ? 5000 : false,
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
      setIssueError(result.issue_error)
      setIssueJobId(result.job_id)
      setIssueJobRunning(result.job_id !== null)
      setActionError(null)
      toast({ title: 'Domain registered.' })
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
      setIssueError(null)
      setIssueJobRunning(true)
      setActionError(null)
      toast({ title: 'Certificate reissue started.' })
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
      toast({ title: 'Domain removed.' })
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
      <PageHeader
        title="Domains"
        description="One wildcard certificate and one Cloudflare SSL mode cover every name in each registered zone."
        actions={
          <Button
            disabled={!canAdd}
            className="self-start lg:self-auto"
            leftIcon={<Plus weight="regular" aria-hidden className="size-4" />}
            onClick={() => setAddOpen(true)}
          >
            Add domain
          </Button>
        }
      />

      {!zonesQuery.data?.configured ? (
        <Alert tone="warning">
          Cloudflare is not configured. Add an API token in Settings before registering domains.
        </Alert>
      ) : null}

      {actionError ? (
        <p className="text-sm text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}

      {issueError ? (
        <p className="text-sm text-destructive" role="alert">
          {issueError}
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
        <Card>
          <CardBody className="space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
            <span className="sr-only">Loading domains…</span>
          </CardBody>
        </Card>
      ) : null}
      {!tableLoading && !domainsQuery.isError && domains.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Globe weight="regular" className="size-8" aria-hidden />}
            title="No domains registered yet."
          />
        </Card>
      ) : null}
      {!tableLoading
        ? domains.map((row) => {
            const names = zoneHostnames(row)
            const zoneName = zoneNameById.get(row.zone_id) ?? row.zone_id
            return (
              <Card key={row.name} className="overflow-hidden p-0">
                <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Zone</p>
                    <h2 className="truncate font-mono text-lg font-semibold tracking-tight">{zoneName}</h2>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={reissueMutation.isPending}
                      leftIcon={<ArrowsClockwise weight="regular" aria-hidden className="size-4" />}
                      onClick={() => reissueMutation.mutate(row.name)}
                    >
                      Reissue
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={removeMutation.isPending}
                      leftIcon={<Trash weight="regular" aria-hidden className="size-4" />}
                      onClick={() => setRemoveTarget(row.name)}
                    >
                      Remove
                    </Button>
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
                <TableContainer contained={false}>
                  <Table className="min-w-[32rem]">
                    <THead>
                      <TR className="border-b border-border bg-muted/40 hover:bg-muted/40">
                        <TH scope="col" className="min-w-0 px-3 font-medium normal-case tracking-normal">
                          Name
                        </TH>
                        <TH scope="col" className="whitespace-nowrap px-3 font-medium normal-case tracking-normal">
                          Type
                        </TH>
                        <TH scope="col" className="min-w-0 px-3 font-medium normal-case tracking-normal">
                          Use
                        </TH>
                      </TR>
                    </THead>
                    <TBody className="divide-y divide-border">
                      {names.map((entry) => (
                        <TR key={entry.fqdn} className="hover:bg-transparent">
                          <TD className="min-w-0 px-3 font-mono text-sm break-all">{entry.fqdn}</TD>
                          <TD className="whitespace-nowrap px-3">
                            {hostnameType(row.name, entry.fqdn)}
                          </TD>
                          <TD className="min-w-0 px-3 text-muted-foreground">{hostnameUse(entry)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </TableContainer>
              </Card>
            )
          })
        : null}

      {issueJobId ? (
        <section className="space-y-3" aria-labelledby="issue-log-heading">
          <h2 id="issue-log-heading" className="text-xl font-semibold">
            Certificate issue log
          </h2>
          <LogViewer
            key={issueJobId}
            jobId={issueJobId}
            onEnd={() => {
              setIssueJobRunning(false)
              void queryClient.invalidateQueries({ queryKey: ['domains'] })
            }}
          />
        </section>
      ) : null}

      {registerMutation.isPending ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
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
