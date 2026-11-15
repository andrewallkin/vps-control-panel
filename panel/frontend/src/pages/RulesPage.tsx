import { Funnel, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { RuleFormDialog } from '../components/rules/RuleFormDialog'
import { StepUpDialog } from '../components/StepUpDialog'
import {
  Badge,
  Button,
  Card,
  CardBody,
  PageHeader,
  Select,
  Table,
  TableContainer,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '../components/ui'
import { TableSkeletonRows } from '../components/dashboard/TableSkeletonRows'
import { ApiError, isStepUpRequired } from '../lib/api'
import { authQueryKey } from '../lib/auth'
import {
  actionLabel,
  describeExpression,
  draftFromRule,
  emptyDraft,
  type CloudflareCustomRule,
  type RuleAction,
  type RuleDraft,
} from '../lib/cloudflareRules'
import {
  createCloudflareRule,
  deleteCloudflareRule,
  fetchCloudflareRules,
  updateCloudflareRule,
} from '../lib/cloudflareRulesApi'
import { fetchDomains } from '../lib/domainsApi'

function ActionBadge({ action }: { action: RuleAction }) {
  const tone =
    action === 'block' ? 'danger' : action === 'skip' ? 'neutral' : 'warning'
  return <Badge tone={tone}>{actionLabel(action)}</Badge>
}

type EditorState =
  | { mode: 'create'; draft: RuleDraft }
  | { mode: 'edit'; ruleId: string; draft: RuleDraft }

type PendingSave = { editor: EditorState; draft: RuleDraft }

function errorDetail(error: unknown): string {
  if (error instanceof ApiError) {
    const body = error.body as { detail?: string } | null
    if (typeof body?.detail === 'string') {
      return body.detail
    }
  }
  return ''
}

export function RulesPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const domainsQuery = useQuery({
    queryKey: ['domains'],
    queryFn: fetchDomains,
  })
  const domains = domainsQuery.data ?? []
  const [domain, setDomain] = useState('')
  const selectedDomain = domain || domains[0]?.name || ''
  const rulesQuery = useQuery({
    queryKey: ['cloudflare-rules', selectedDomain],
    queryFn: () => fetchCloudflareRules(selectedDomain),
    enabled: selectedDomain !== '',
  })
  const rules = rulesQuery.data?.rules ?? []
  const permissionDenied = rulesQuery.data?.error === 'permission'
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CloudflareCustomRule | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingSave, setPendingSave] = useState<PendingSave | null>(null)
  const [pendingDelete, setPendingDelete] = useState<CloudflareCustomRule | null>(null)
  const [stepUpOpen, setStepUpOpen] = useState(false)

  const otherRules = useMemo(() => {
    if (editor?.mode !== 'edit') {
      return rules
    }
    return rules.filter((rule) => rule.id !== editor.ruleId)
  }, [editor, rules])

  async function refreshRules() {
    await queryClient.invalidateQueries({ queryKey: ['cloudflare-rules', selectedDomain] })
    await queryClient.invalidateQueries({ queryKey: authQueryKey })
  }

  async function saveRule(current: EditorState, draft: RuleDraft) {
    if (current.mode === 'edit') {
      await updateCloudflareRule(selectedDomain, current.ruleId, draft)
      toast({ title: 'Rule updated.' })
    } else {
      await createCloudflareRule(selectedDomain, draft)
      toast({ title: 'Rule added.' })
    }
    setEditor(null)
    setPendingSave(null)
    await refreshRules()
  }

  async function removeRule(rule: CloudflareCustomRule) {
    await deleteCloudflareRule(selectedDomain, rule.id)
    setDeleteTarget(null)
    setPendingDelete(null)
    toast({ title: 'Rule deleted.' })
    await refreshRules()
  }

  const saveMutation = useMutation({
    mutationFn: ({ current, draft }: { current: EditorState; draft: RuleDraft }) =>
      saveRule(current, draft),
    onError: (error, variables) => {
      if (isStepUpRequired(error)) {
        setPendingSave({ editor: variables.current, draft: variables.draft })
        setStepUpOpen(true)
        return
      }
      setActionError(errorDetail(error) || 'Could not save the rule.')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (rule: CloudflareCustomRule) => removeRule(rule),
    onError: (error, rule) => {
      if (isStepUpRequired(error)) {
        setPendingDelete(rule)
        setStepUpOpen(true)
        return
      }
      setDeleteTarget(null)
      setActionError(errorDetail(error) || 'Could not delete the rule.')
    },
  })

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader
        title="Rules"
        description="Cloudflare custom rules for a domain. Changes are saved to that zone."
        actions={
          <Button
            disabled={!selectedDomain || permissionDenied || domainsQuery.isPending}
            className="min-h-11"
            leftIcon={<Plus weight="regular" aria-hidden className="size-4" />}
            onClick={() => setEditor({ mode: 'create', draft: emptyDraft() })}
          >
            Add rule
          </Button>
        }
      />

      <Card>
        <CardBody className="space-y-3">
          <label htmlFor="rules-domain" className="block text-sm font-medium">
            Domain
          </label>
          <Select
            id="rules-domain"
            className="max-w-md"
            value={selectedDomain}
            disabled={domains.length === 0}
            onChange={(event) => {
              setDomain(event.target.value)
              setEditor(null)
              setDeleteTarget(null)
              setActionError(null)
            }}
          >
            {domains.length === 0 ? <option value="">No domains yet</option> : null}
            {domains.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </Select>
          {domainsQuery.isError ? (
            <p className="text-sm text-destructive" role="alert">
              Could not load domains.
            </p>
          ) : null}
        </CardBody>
      </Card>

      {permissionDenied ? (
        <p className="text-sm text-destructive" role="alert">
          Add Zone WAF Edit on the Cloudflare token, then save it in Settings.
        </p>
      ) : null}
      {rulesQuery.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {errorDetail(rulesQuery.error) || 'Could not load Cloudflare rules.'}
        </p>
      ) : null}
      {actionError ? (
        <p className="text-sm text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}

      <section className="space-y-3" aria-labelledby="rules-list-heading">
        <h2 id="rules-list-heading" className="text-xl font-semibold">
          Custom rules{' '}
          <span className="font-normal text-muted-foreground">
            {rules.length} {rules.length === 1 ? 'rule' : 'rules'}
          </span>
        </h2>
        <TableContainer>
          <Table className="min-w-[720px]">
            <THead>
              <TR className="border-b border-border bg-muted/40 hover:bg-muted/40">
                <TH scope="col" className="whitespace-nowrap px-3 font-medium normal-case tracking-normal">
                  Order
                </TH>
                <TH scope="col" className="whitespace-nowrap px-3 font-medium normal-case tracking-normal">
                  Name
                </TH>
                <TH scope="col" className="px-3 font-medium normal-case tracking-normal">
                  Description
                </TH>
                <TH scope="col" className="whitespace-nowrap px-3 font-medium normal-case tracking-normal">
                  Action
                </TH>
                <TH scope="col" className="whitespace-nowrap px-3 font-medium normal-case tracking-normal">
                  Status
                </TH>
                <TH scope="col" className="px-3 font-medium normal-case tracking-normal">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {rules.map((rule, index) => (
                <TR key={rule.id}>
                  <TD className="whitespace-nowrap px-3 font-mono text-sm tabular-nums">{index + 1}</TD>
                  <TD className="whitespace-nowrap px-3 font-medium">{rule.name}</TD>
                  <TD className="max-w-xl px-3 text-muted-foreground">
                    {rule.description.trim() || describeExpression(rule.expression)}
                  </TD>
                  <TD className="whitespace-nowrap px-3">
                    <ActionBadge action={rule.action} />
                  </TD>
                  <TD className="whitespace-nowrap px-3">
                    <Badge tone={rule.enabled ? 'success' : 'neutral'} dot>
                      {rule.enabled ? 'Active' : 'Disabled'}
                    </Badge>
                  </TD>
                  <TD className="whitespace-nowrap px-3">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="min-h-11"
                        leftIcon={<PencilSimple weight="regular" aria-hidden className="size-4" />}
                        onClick={() =>
                          setEditor({
                            mode: 'edit',
                            ruleId: rule.id,
                            draft: draftFromRule(rule, rules),
                          })
                        }
                      >
                        Edit
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        className="min-h-11"
                        aria-label={`Delete ${rule.name}`}
                        leftIcon={<Trash weight="regular" aria-hidden className="size-4" />}
                        onClick={() => setDeleteTarget(rule)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
              {rulesQuery.isLoading ? (
                <TableSkeletonRows columns={6} rows={4} />
              ) : null}
              {!rulesQuery.isLoading && rules.length === 0 ? (
                <TR className="hover:bg-transparent">
                  <TD colSpan={6} className="px-3 py-6 text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Funnel weight="regular" aria-hidden className="size-4" />
                      {selectedDomain
                        ? 'No custom rules on this domain.'
                        : 'Add a domain before managing rules.'}
                    </span>
                  </TD>
                </TR>
              ) : null}
            </TBody>
          </Table>
        </TableContainer>
      </section>

      {editor ? (
        <RuleFormDialog
          key={editor.mode === 'edit' ? editor.ruleId : 'new'}
          open
          mode={editor.mode}
          draft={editor.draft}
          otherRules={otherRules}
          onCancel={() => setEditor(null)}
          onSubmit={(draft) => {
            if (!editor || saveMutation.isPending) {
              return
            }
            setActionError(null)
            saveMutation.mutate({ current: editor, draft })
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete rule"
        description={
          deleteTarget
            ? `Delete "${deleteTarget.name}" from ${selectedDomain}? This removes it from Cloudflare.`
            : ''
        }
        confirmLabel="Delete rule"
        busy={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            setActionError(null)
            deleteMutation.mutate(deleteTarget)
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <StepUpDialog
        key={stepUpOpen ? 'rules-step-up-open' : 'rules-step-up-closed'}
        open={stepUpOpen}
        onCancel={() => {
          setStepUpOpen(false)
          setPendingSave(null)
          setPendingDelete(null)
        }}
        onVerified={() => {
          setStepUpOpen(false)
          if (pendingSave) {
            saveMutation.mutate({ current: pendingSave.editor, draft: pendingSave.draft })
          } else if (pendingDelete) {
            deleteMutation.mutate(pendingDelete)
          }
        }}
      />

    </div>
  )
}
