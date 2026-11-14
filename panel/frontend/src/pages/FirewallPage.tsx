import { CheckCircle, Lock, Plus, Trash, XCircle } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { AddFirewallRuleDialog } from '../components/firewall/AddFirewallRuleDialog'
import { StepUpDialog } from '../components/StepUpDialog'
import {
  Badge,
  Button,
  Card,
  CardBody,
  PageHeader,
  Spinner,
  Switch,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../components/ui'
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
  CF_LOCK_REASON,
  CF_ONLY_SUMMARY,
  EXPOSURE_GUIDANCE,
  formatAction,
  formatFamily,
  formatProcess,
  formatSource,
  isCloudflareOnlyMode,
  isRuleLocked,
  KEPT_OPEN_LABEL,
  portFromTo,
  splitExposure,
  SSH_DELETE_HELPER,
  WEB_LOCK_REASON,
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

function lockReason(rule: FirewallRule, cfOnly: boolean): string {
  if (cfOnly && rule.comment === 'cf') {
    return CF_LOCK_REASON
  }
  return WEB_LOCK_REASON
}

function serviceAndProcess(process: string): { service: string; program: string } {
  if (!process) {
    return { service: '—', program: '—' }
  }
  const label = formatProcess(process)
  if (label === process) {
    return { service: process, program: '—' }
  }
  return { service: label, program: process }
}

function PublicStatus({ expected, port }: { expected: boolean; port: number }) {
  if (expected) {
    return (
      <Badge tone="success">
        <CheckCircle weight="regular" aria-hidden className="size-4 shrink-0" />
        Public
      </Badge>
    )
  }
  return (
    <Badge
      tone="danger"
      aria-label={`Problem: port ${port} is reachable from the internet`}
    >
      <XCircle weight="regular" aria-hidden className="size-4 shrink-0" />
      Problem
    </Badge>
  )
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
  const exposure = useMemo(
    () => splitExposure(exposureQuery.data ?? []),
    [exposureQuery.data],
  )

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
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Firewall"
        description="Who can reach this server, and which programs are listening."
        actions={
          <Button
            leftIcon={<Plus weight="regular" aria-hidden className="size-4" />}
            onClick={() => setAddOpen(true)}
          >
            Add rule
          </Button>
        }
      />

      <Card aria-labelledby="cf-only-heading">
        <CardBody className="space-y-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
            <div className="min-w-0 flex-1 space-y-1">
              <h2 id="cf-only-heading" className="text-base font-semibold">
                Cloudflare-only mode
              </h2>
              <p className="max-w-3xl text-sm text-muted-foreground">{CF_ONLY_SUMMARY}</p>
            </div>
            <label className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-3 self-start">
              <span className="text-sm font-medium">{cfOnly ? 'On' : 'Off'}</span>
              <Switch
                checked={cfOnly}
                aria-labelledby="cf-only-heading"
                disabled={cfMutation.isPending || rulesQuery.isPending}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setCfConfirmOn(true)
                    return
                  }
                  cfMutation.mutate(false)
                }}
              />
            </label>
          </div>
        </CardBody>
      </Card>

      {actionError ? (
        <p className="text-sm text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}

      <section className="space-y-3" aria-labelledby="fw-rules-heading">
        <h2 id="fw-rules-heading" className="text-base font-semibold">
          Rules
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{SSH_DELETE_HELPER}</p>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {cfOnly ? CF_LOCK_REASON : WEB_LOCK_REASON}
        </p>
        {rulesQuery.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Could not load rules.
          </p>
        ) : null}

        <TableContainer>
          <Table className="min-w-[800px]">
            <THead>
              <TR className="border-b border-border bg-muted/40 hover:bg-muted/40">
                <TH scope="col" className="whitespace-nowrap px-3 font-medium normal-case tracking-normal">
                  Port / range
                </TH>
                <TH scope="col" className="whitespace-nowrap px-3 font-medium normal-case tracking-normal">
                  Family
                </TH>
                <TH scope="col" className="whitespace-nowrap px-3 font-medium normal-case tracking-normal">
                  Proto
                </TH>
                <TH scope="col" className="whitespace-nowrap px-3 font-medium normal-case tracking-normal">
                  Action
                </TH>
                <TH scope="col" className="min-w-[8rem] px-3 font-medium normal-case tracking-normal">
                  Source
                </TH>
                <TH scope="col" className="min-w-[8rem] px-3 font-medium normal-case tracking-normal">
                  Comment
                </TH>
                <TH scope="col" className="whitespace-nowrap px-3 text-right font-medium normal-case tracking-normal">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody className="divide-y divide-border">
              {rulesQuery.isPending ? (
                <TR className="hover:bg-transparent">
                  <TD colSpan={7} className="px-3 py-6 text-muted-foreground">
                    Loading rules…
                  </TD>
                </TR>
              ) : null}
              {rules.map((rule) => {
                const locked = isRuleLocked(rule, cfOnly)
                const portLabel = portFromTo(rule.to)
                const reason = lockReason(rule, cfOnly)
                const sourceLabel = formatSource(rule.from)
                return (
                  <TR key={rule.number}>
                    <TD className="whitespace-nowrap px-3 font-mono text-xs">{portLabel}</TD>
                    <TD className="whitespace-nowrap px-3">{formatFamily(rule.v6)}</TD>
                    <TD className="whitespace-nowrap px-3 font-mono text-xs">{rule.proto}</TD>
                    <TD className="whitespace-nowrap px-3">{formatAction(rule.action)}</TD>
                    <TD
                      className={
                        sourceLabel === rule.from
                          ? 'min-w-[8rem] break-all px-3 font-mono text-xs'
                          : 'min-w-[8rem] px-3'
                      }
                    >
                      {sourceLabel}
                    </TD>
                    <TD className="min-w-[8rem] break-words px-3 text-muted-foreground">
                      {rule.comment || '—'}
                    </TD>
                    <TD className="whitespace-nowrap px-3">
                      <div className="flex items-center justify-end gap-2">
                        <span className="inline-flex w-[7.5rem] shrink-0 items-center justify-end">
                          {locked ? (
                            <span
                              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                              title={reason}
                              aria-label={`${portLabel} locked`}
                            >
                              <Lock weight="regular" aria-hidden className="size-4 shrink-0" />
                              <span>{KEPT_OPEN_LABEL}</span>
                            </span>
                          ) : null}
                        </span>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={locked || deleteMutation.isPending}
                          aria-label={`Delete rule ${rule.number}`}
                          title={locked ? reason : undefined}
                          className="w-[5.75rem] shrink-0 disabled:border-border disabled:bg-transparent disabled:text-muted-foreground disabled:hover:bg-transparent"
                          leftIcon={<Trash weight="regular" aria-hidden className="size-4" />}
                          onClick={() => setDeleteTarget(rule)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TD>
                  </TR>
                )
              })}
              {!rulesQuery.isPending && !rulesQuery.isError && rules.length === 0 ? (
                <TR className="hover:bg-transparent">
                  <TD colSpan={7} className="px-3 py-6 text-muted-foreground">
                    No firewall rules yet.
                  </TD>
                </TR>
              ) : null}
            </TBody>
          </Table>
        </TableContainer>
      </section>

      <section className="space-y-3" aria-labelledby="fw-exposure-heading">
        <h2 id="fw-exposure-heading" className="text-base font-semibold">
          Exposure report
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{EXPOSURE_GUIDANCE}</p>
        {exposureQuery.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Could not load exposure report.
          </p>
        ) : null}

        <div className="space-y-2">
          <h3 className="text-sm font-medium">Reachable from the internet</h3>
          <TableContainer>
            <Table className="min-w-[720px]">
              <THead>
                <TR className="border-b border-border bg-muted/40 hover:bg-muted/40">
                  <TH scope="col" className="whitespace-nowrap px-3 font-medium normal-case tracking-normal">
                    Port
                  </TH>
                  <TH scope="col" className="whitespace-nowrap px-3 font-medium normal-case tracking-normal">
                    Protocol
                  </TH>
                  <TH scope="col" className="min-w-[6rem] px-3 font-medium normal-case tracking-normal">
                    Service
                  </TH>
                  <TH scope="col" className="min-w-[8rem] px-3 font-medium normal-case tracking-normal">
                    Process
                  </TH>
                  <TH scope="col" className="min-w-[6rem] px-3 font-medium normal-case tracking-normal">
                    Reach
                  </TH>
                  <TH scope="col" className="whitespace-nowrap px-3 font-medium normal-case tracking-normal">
                    Status
                  </TH>
                </TR>
              </THead>
              <TBody className="divide-y divide-border">
                {exposureQuery.isPending ? (
                  <TR className="hover:bg-transparent">
                    <TD colSpan={6} className="px-3 py-6 text-muted-foreground">
                      Loading exposure…
                    </TD>
                  </TR>
                ) : null}
                {exposure.publicListeners.map((row) => {
                  const names = serviceAndProcess(row.process)
                  return (
                    <TR key={row.key}>
                      <TD className="whitespace-nowrap px-3 font-mono text-xs">{row.port}</TD>
                      <TD className="whitespace-nowrap px-3 font-mono text-xs">{row.proto}</TD>
                      <TD className="min-w-[6rem] px-3">{names.service}</TD>
                      <TD className="min-w-[8rem] break-all px-3 font-mono text-xs text-muted-foreground">
                        {names.program}
                      </TD>
                      <TD className="min-w-[6rem] px-3">{row.reach}</TD>
                      <TD className="whitespace-nowrap px-3">
                        <PublicStatus expected={row.expected} port={row.port} />
                      </TD>
                    </TR>
                  )
                })}
                {!exposureQuery.isPending &&
                !exposureQuery.isError &&
                exposure.publicListeners.length === 0 ? (
                  <TR className="hover:bg-transparent">
                    <TD colSpan={6} className="px-3 py-6 text-muted-foreground">
                      Nothing is reachable from the internet.
                    </TD>
                  </TR>
                ) : null}
              </TBody>
            </Table>
          </TableContainer>
        </div>

        {!exposureQuery.isPending && !exposureQuery.isError && exposure.localListeners.length > 0 ? (
          <details className="space-y-2">
            <summary className="cursor-pointer text-sm font-medium">
              Only on this machine ({exposure.localListeners.length})
            </summary>
            <p className="max-w-3xl text-sm text-muted-foreground">
              These programs are not reachable from the internet.
            </p>
            <TableContainer>
              <Table className="min-w-[720px]">
                <THead>
                  <TR className="border-b border-border bg-muted/40 hover:bg-muted/40">
                    <TH scope="col" className="min-w-[8rem] px-3 font-medium normal-case tracking-normal">
                      Address
                    </TH>
                    <TH scope="col" className="whitespace-nowrap px-3 font-medium normal-case tracking-normal">
                      Port
                    </TH>
                    <TH scope="col" className="whitespace-nowrap px-3 font-medium normal-case tracking-normal">
                      Protocol
                    </TH>
                    <TH scope="col" className="min-w-[6rem] px-3 font-medium normal-case tracking-normal">
                      Service
                    </TH>
                    <TH scope="col" className="min-w-[8rem] px-3 font-medium normal-case tracking-normal">
                      Process
                    </TH>
                    <TH scope="col" className="min-w-[8rem] px-3 font-medium normal-case tracking-normal">
                      Status
                    </TH>
                  </TR>
                </THead>
                <TBody className="divide-y divide-border">
                  {exposure.localListeners.map((row) => {
                    const names = serviceAndProcess(row.process)
                    return (
                      <TR key={row.key}>
                        <TD className="min-w-[8rem] break-all px-3">
                          <span className="font-mono text-xs">{row.address}</span>
                          {row.scopeLabel ? (
                            <span className="ml-1.5 text-xs text-muted-foreground">{row.scopeLabel}</span>
                          ) : null}
                        </TD>
                        <TD className="whitespace-nowrap px-3 font-mono text-xs">{row.port}</TD>
                        <TD className="whitespace-nowrap px-3 font-mono text-xs">{row.proto}</TD>
                        <TD className="min-w-[6rem] px-3">{names.service}</TD>
                        <TD className="min-w-[8rem] break-all px-3 font-mono text-xs text-muted-foreground">
                          {names.program}
                        </TD>
                        <TD className="min-w-[8rem] px-3 text-sm text-muted-foreground">
                          {row.blockedByFirewall ? 'Blocked by the firewall' : 'Local only'}
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            </TableContainer>
          </details>
        ) : null}
      </section>

      {addMutation.isPending ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
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
        description="The site will accept HTTP and HTTPS only from Cloudflare's addresses. Visiting this server's IP on ports 80 and 443 will stop working. SSH is unchanged."
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