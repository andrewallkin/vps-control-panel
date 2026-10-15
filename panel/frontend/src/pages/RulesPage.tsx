import { Funnel, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { RuleFormDialog } from '../components/rules/RuleFormDialog'
import { StepUpDialog } from '../components/StepUpDialog'
import { Toast } from '../components/Toast'
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
    action === 'block'
      ? 'border-destructive/40 text-destructive'
      : action === 'skip'
        ? 'border-border bg-muted text-foreground'
        : 'border-warning/50 text-warning'
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {actionLabel(action)}
    </span>
  )
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
  const [toast, setToast] = useState<string | null>(null)
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
      setToast('Rule updated.')
    } else {
      await createCloudflareRule(selectedDomain, draft)
      setToast('Rule added.')
    }
    setEditor(null)
    setPendingSave(null)
    await refreshRules()
  }

  async function removeRule(rule: CloudflareCustomRule) {
    await deleteCloudflareRule(selectedDomain, rule.id)
    setDeleteTarget(null)
    setPendingDelete(null)
    setToast('Rule deleted.')
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Rules</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Cloudflare custom rules for a domain. Changes are saved to that zone.
          </p>
        </div>
        <button
          type="button"
          disabled={!selectedDomain || permissionDenied || domainsQuery.isPending}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => setEditor({ mode: 'create', draft: emptyDraft() })}
        >
          <Plus weight="regular" aria-hidden className="size-4" />
          Add rule
        </button>
      </div>

      <section className="space-y-3 rounded-lg border border-border bg-card p-4">
        <label htmlFor="rules-domain" className="block text-sm font-medium">
          Domain
        </label>
        <select
          id="rules-domain"
          value={selectedDomain}
          disabled={domains.length === 0}
          className="w-full max-w-md rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50"
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
        </select>
        {domainsQuery.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Could not load domains.
          </p>
        ) : null}
      </section>

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
        <h2 id="rules-list-heading" className="text-base font-semibold">
          Custom rules{' '}
          <span className="font-normal text-muted-foreground">
            {rules.length} {rules.length === 1 ? 'rule' : 'rules'}
          </span>
        </h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-muted-foreground">
              <tr>
                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                  Order
                </th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Description
                </th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                  Action
                </th>
                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, index) => (
                <tr key={rule.id} className="border-b border-border last:border-b-0">
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{index + 1}</td>
                  <td className="whitespace-nowrap px-3 py-3 font-medium">{rule.name}</td>
                  <td className="max-w-xl px-3 py-3 text-muted-foreground">
                    {rule.description.trim() || describeExpression(rule.expression)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <ActionBadge action={rule.action} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden
                        className={`size-2 rounded-full ${rule.enabled ? 'bg-accent' : 'bg-muted-foreground'}`}
                      />
                      {rule.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors duration-200 hover:bg-muted"
                        onClick={() =>
                          setEditor({
                            mode: 'edit',
                            ruleId: rule.id,
                            draft: draftFromRule(rule, rules),
                          })
                        }
                      >
                        <PencilSimple weight="regular" aria-hidden className="size-4" />
                        Edit
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${rule.name}`}
                        className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border border-destructive/50 bg-transparent px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors duration-200 hover:bg-destructive/10"
                        onClick={() => setDeleteTarget(rule)}
                      >
                        <Trash weight="regular" aria-hidden className="size-4" />
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rulesQuery.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-sm text-muted-foreground">
                    Loading rules…
                  </td>
                </tr>
              ) : null}
              {!rulesQuery.isLoading && rules.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Funnel weight="regular" aria-hidden className="size-4" />
                      {selectedDomain
                        ? 'No custom rules on this domain.'
                        : 'Add a domain before managing rules.'}
                    </span>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
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

      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  )
}
