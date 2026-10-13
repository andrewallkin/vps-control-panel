import {
  CheckCircle,
  Lock,
  Plus,
  Spinner,
  Trash,
  XCircle,
} from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { AddFirewallRuleDialog } from '../components/firewall/AddFirewallRuleDialog'
import { StepUpDialog } from '../components/StepUpDialog'
import { ApiError, isStepUpRequired } from '../lib/api'
import {
  addFirewallRule,
  deleteFirewallRule,
  fetchFirewallExposure,
  fetchFirewallRules,
  setCloudflareOnly,
  type AddFirewallRulePayload,
  type FirewallRule,
} from '../lib/firewallApi'
import {
  EXPOSURE_GUIDANCE,
  formatAction,
  isCloudflareOnlyMode,
  isRuleLocked,
  LOCK_TOOLTIP_CF_RULES,
  LOCK_TOOLTIP_WEB_PORTS,
  portFromTo,
  SSH_DELETE_HELPER,
} from '../lib/firewallUtils'
import { authQueryKey } from '../lib/auth'

type PendingMutation =
  | { kind: 'add'; payload: AddFirewallRulePayload }
  | { kind: 'delete'; rule: FirewallRule }
  | { kind: 'cloudflare-only'; on: boolean }
  | null

function apiErrorDetail(error: unknown): string {
  if (error instanceof ApiError && error.body && typeof error.body === 'object') {
    const detail = (error.body as { detail?: unknown }).detail
    if (typeof detail === 'string') {
      return detail
    }
  }
  return ''
}

function lockTooltip(rule: FirewallRule, cfOnly: boolean): string {
  if (cfOnly && rule.comment === 'cf') {
    return LOCK_TOOLTIP_CF_RULES
  }
  return LOCK_TOOLTIP_WEB_PORTS
}

function ExposureStatus({ row }: { row: { external: boolean; expected: boolean; port: number } }) {
  if (row.external && row.expected) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-accent">
        <CheckCircle weight="regular" aria-hidden className="size-4 shrink-0" />
        <span>Expected</span>
      </span>
    )
  }
  if (row.external && !row.expected) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive"
        aria-label={`Unexpected exposure on port ${row.port}`}
      >
        <XCircle weight="regular" aria-hidden className="size-4 shrink-0" />
        <span>Unexpected</span>
      </span>
    )
  }
  return <span className="text-sm text-muted-foreground">—</span>
}

export function FirewallPage() {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<FirewallRule | null>(null)
  const [cfConfirmOn, setCfConfirmOn] = useState<boolean | null>(null)
  const [stepUpOpen, setStepUpOpen] = useState(false)
  const [pendingMutation, setPendingMutation] = useState<PendingMutation>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const rulesQuery = useQuery({
    queryKey: ['firewall', 'rules'],
    queryFn: fetchFirewallRules,
    refetchIntervalInBackground: false,
  })

  const exposureQuery = useQuery({
    queryKey: ['firewall', 'exposure'],
    queryFn: fetchFirewallExposure,
    refetchIntervalInBackground: false,
  })

  const cfOnly = useMemo(
    () => isCloudflareOnlyMode(rulesQuery.data ?? []),
    [rulesQuery.data],
  )
  const rules = rulesQuery.data ?? []

  const runPending = async (mutation: PendingMutation) => {
    if (!mutation) {
      return
    }
    setActionError(null)
    try {
      if (mutation.kind === 'add') {
        await addFirewallRule(mutation.payload)
        setAddOpen(false)
      } else if (mutation.kind === 'delete') {
        const rule = mutation.rule
        await deleteFirewallRule(rule.number, {
          to: rule.to,
          proto: rule.proto,
          action: rule.action,
          from: rule.from,
          v6: rule.v6,
          comment: rule.comment,
        })
        setDeleteTarget(null)
      } else {
        await setCloudflareOnly(mutation.on)
      }
      await queryClient.invalidateQueries({ queryKey: ['firewall'] })
      await queryClient.invalidateQueries({ queryKey: authQueryKey })
    } catch (error) {
      if (isStepUpRequired(error)) {
        setPendingMutation(mutation)
        setStepUpOpen(true)
        return
      }
      if (mutation.kind === 'delete') {
        const detail = apiErrorDetail(error)
        setActionError(detail || 'Could not delete firewall rule.')
        setDeleteTarget(null)
        return
      }
      setActionError('Firewall change failed.')
    }
  }

  const addMutation = useMutation({
    mutationFn: (payload: AddFirewallRulePayload) => runPending({ kind: 'add', payload }),
  })

  const deleteMutation = useMutation({
    mutationFn: (rule: FirewallRule) => runPending({ kind: 'delete', rule }),
  })

  const cfMutation = useMutation({
    mutationFn: (on: boolean) => runPending({ kind: 'cloudflare-only', on }),
  })

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Firewall</h1>
          <p className="text-sm text-muted-foreground">
            UFW rules, Cloudflare-only web exposure, and listening socket report.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => setAddOpen(true)}
        >
          <Plus weight="regular" aria-hidden className="size-4" />
          Add rule
        </button>
      </div>

      <section
        className="space-y-3 rounded-lg border border-border bg-card p-4"
        aria-labelledby="cf-only-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 id="cf-only-heading" className="text-base font-semibold">
              Cloudflare-only mode
            </h2>
            <p className="text-sm text-muted-foreground">
              When enabled, open HTTP/HTTPS rules are replaced with Cloudflare published IP ranges.
              Mode is on when any rule carries the <span className="font-mono">cf</span> comment.
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="size-4 rounded border-border accent-accent"
              checked={cfOnly}
              disabled={cfMutation.isPending || rulesQuery.isPending}
              onChange={(event) => {
                if (event.target.checked) {
                  setCfConfirmOn(true)
                  return
                }
                cfMutation.mutate(false)
              }}
            />
            Cloudflare-only
          </label>
        </div>
      </section>

      {actionError ? (
        <p className="text-sm text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}

      <section className="space-y-3" aria-labelledby="fw-rules-heading">
        <h2 id="fw-rules-heading" className="text-base font-semibold">
          Rules
        </h2>
        <p className="text-sm text-muted-foreground">{SSH_DELETE_HELPER}</p>
        {rulesQuery.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Could not load rules.
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Port / range
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Proto
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Action
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Source
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Comment
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rulesQuery.isPending ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-sm text-muted-foreground">
                    Loading rules…
                  </td>
                </tr>
              ) : null}
              {rules.map((rule) => {
                const locked = isRuleLocked(rule, cfOnly)
                const portLabel = portFromTo(rule.to)
                return (
                  <tr key={rule.number}>
                    <td className="px-3 py-2 font-mono text-xs">{portLabel}</td>
                    <td className="px-3 py-2 font-mono text-xs">{rule.proto}</td>
                    <td className="px-3 py-2">{formatAction(rule.action)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{rule.from}</td>
                    <td className="px-3 py-2 text-muted-foreground">{rule.comment || '—'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {locked ? (
                          <span
                            className="inline-flex text-muted-foreground"
                            title={lockTooltip(rule, cfOnly)}
                            aria-label={`${portLabel} locked`}
                          >
                            <Lock weight="regular" aria-hidden className="size-4" />
                          </span>
                        ) : null}
                        <button
                          type="button"
                          disabled={locked || deleteMutation.isPending}
                          aria-label={`Delete rule ${rule.number}`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors duration-200 hover:bg-destructive/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          onClick={() => setDeleteTarget(rule)}
                        >
                          <Trash weight="regular" aria-hidden className="size-4" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!rulesQuery.isPending && !rulesQuery.isError && rules.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-sm text-muted-foreground">
                    No firewall rules yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="fw-exposure-heading">
        <h2 id="fw-exposure-heading" className="text-base font-semibold">
          Exposure report
        </h2>
        <p className="text-sm text-muted-foreground">{EXPOSURE_GUIDANCE}</p>
        {exposureQuery.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Could not load exposure report.
          </p>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Address
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Port
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Proto
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Process
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {exposureQuery.isPending ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-sm text-muted-foreground">
                    Loading exposure…
                  </td>
                </tr>
              ) : null}
              {(exposureQuery.data ?? []).map((row) => (
                <tr
                  key={`${row.address}-${row.port}-${row.proto}`}
                >
                  <td className="px-3 py-2 font-mono text-xs">{row.address}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.port}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.proto}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.process || '—'}</td>
                  <td className="px-3 py-2">
                    <ExposureStatus row={row} />
                  </td>
                </tr>
              ))}
              {!exposureQuery.isPending &&
              !exposureQuery.isError &&
              (exposureQuery.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-sm text-muted-foreground">
                    No listening sockets reported.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {addMutation.isPending ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner weight="regular" aria-hidden className="size-4 animate-spin" />
          Adding rule…
        </p>
      ) : null}

      <AddFirewallRuleDialog
        key={addOpen ? 'fw-add-open' : 'fw-add-closed'}
        open={addOpen}
        busy={addMutation.isPending}
        onCancel={() => setAddOpen(false)}
        onSubmit={(payload) => addMutation.mutate(payload)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete firewall rule"
        description={`Remove rule ${deleteTarget?.number ?? ''} (${deleteTarget ? portFromTo(deleteTarget.to) : ''}/${deleteTarget?.proto ?? ''})? This requires step-up verification.`}
        confirmLabel="Delete rule"
        busy={deleteMutation.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate(deleteTarget)
          }
        }}
      />

      <ConfirmDialog
        open={cfConfirmOn === true}
        title="Enable Cloudflare-only mode"
        description="Turning this on replaces the open 80/443 rules with Cloudflare's published IP ranges."
        confirmLabel="Enable"
        busy={cfMutation.isPending}
        onCancel={() => setCfConfirmOn(null)}
        onConfirm={() => {
          setCfConfirmOn(null)
          cfMutation.mutate(true)
        }}
      />

      <StepUpDialog
        key={stepUpOpen ? 'fw-step-up-open' : 'fw-step-up-closed'}
        open={stepUpOpen}
        onCancel={() => {
          setStepUpOpen(false)
          setPendingMutation(null)
        }}
        onVerified={() => {
          setStepUpOpen(false)
          const pending = pendingMutation
          setPendingMutation(null)
          void runPending(pending)
        }}
      />
    </div>
  )
}
