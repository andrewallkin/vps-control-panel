import { Plus, Spinner } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { AddDomainDialog } from '../domains/AddDomainDialog'
import { CertStatusBadge } from '../domains/CertStatusBadge'
import { LogViewer } from './LogViewer'
import {
  fetchCloudflareZones,
  fetchDomains,
  registerDomain,
  reissueDomain,
} from '../../lib/domainsApi'
import { useTickingNow } from '../../hooks/useTickingNow'

export interface DomainsSetupStepProps {
  onCertReady: () => void
}

export function DomainsSetupStep({ onCertReady }: DomainsSetupStepProps) {
  const queryClient = useQueryClient()
  const nowMs = useTickingNow(60_000)
  const [addOpen, setAddOpen] = useState(false)
  const [issueJobId, setIssueJobId] = useState<string | null>(null)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const zonesQuery = useQuery({
    queryKey: ['cloudflare', 'zones'],
    queryFn: fetchCloudflareZones,
    refetchIntervalInBackground: false,
  })

  const domainsQuery = useQuery({
    queryKey: ['domains'],
    queryFn: fetchDomains,
    refetchIntervalInBackground: false,
    refetchInterval: 5000,
  })

  const hasValidCert = (domainsQuery.data ?? []).some((row) => row.cert_status === 'valid')

  useEffect(() => {
    if (hasValidCert) {
      onCertReady()
    }
  }, [hasValidCert, onCertReady])

  const registerMutation = useMutation({
    mutationFn: registerDomain,
    onSuccess: (result) => {
      setAddOpen(false)
      setIssueJobId(result.job_id)
      setIssueError(result.issue_error)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['domains'] })
    },
    onError: (err) => {
      if (err instanceof Error && 'status' in err && err.status === 409) {
        setError('This domain is already registered — use Reissue certificate below if needed.')
        return
      }
      setError('Could not register domain.')
    },
  })

  const reissueMutation = useMutation({
    mutationFn: reissueDomain,
    onSuccess: (result) => {
      setIssueJobId(result.job_id)
      setIssueError(null)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['domains'] })
    },
    onError: () => setError('Could not start certificate issuance.'),
  })

  const zones = zonesQuery.data?.zones ?? []

  return (
    <section className="space-y-4" aria-labelledby="domains-step-heading">
      <h2 id="domains-step-heading" className="text-base font-semibold">
        Domains
      </h2>
      <p className="text-sm text-muted-foreground">
        Add at least one apex domain. Certificate issuance runs in the background; continue once a
        certificate shows as valid.
      </p>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {issueError ? (
        <div className="space-y-1 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3">
          <p className="text-sm font-medium text-destructive">Certificate issuance failed.</p>
          <p className="text-sm text-destructive">{issueError}</p>
          <p className="text-xs text-muted-foreground">
            The domain is registered — fix the issue and use Reissue certificate.
          </p>
        </div>
      ) : null}

      <ul className="space-y-2">
        {(domainsQuery.data ?? []).map((row) => (
          <li
            key={row.name}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3"
          >
            <span className="font-medium">{row.name}</span>
            <span className="flex items-center gap-2">
              <CertStatusBadge
                certStatus={row.cert_status}
                certExpiresAt={row.cert_expires_at}
                nowMs={nowMs}
              />
              {row.cert_status !== 'valid' ? (
                <button
                  type="button"
                  disabled={reissueMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => reissueMutation.mutate(row.name)}
                >
                  {reissueMutation.isPending ? (
                    <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
                  ) : null}
                  Reissue certificate
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        onClick={() => setAddOpen(true)}
      >
        <Plus weight="regular" aria-hidden className="size-4" />
        Add domain
      </button>

      {issueJobId ? (
        <LogViewer
          key={issueJobId}
          jobId={issueJobId}
          onEnd={() => {
            void queryClient.invalidateQueries({ queryKey: ['domains'] })
            void queryClient.invalidateQueries({ queryKey: ['setup', 'state'] })
          }}
        />
      ) : null}

      {!hasValidCert && (domainsQuery.data ?? []).length > 0 ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
          Waiting for certificate…
        </p>
      ) : null}

      <AddDomainDialog
        key={addOpen ? 'setup-add-domain-open' : 'setup-add-domain-closed'}
        open={addOpen}
        zones={zones}
        busy={registerMutation.isPending}
        onCancel={() => setAddOpen(false)}
        onSubmit={(payload) => registerMutation.mutate(payload)}
      />
    </section>
  )
}
