import { CaretDown, CaretUp } from '@phosphor-icons/react'
import { useEffect, useId, useRef, useState } from 'react'
import {
  ACTION_OPTIONS,
  EXPRESSION_LIMIT,
  SKIP_OPTIONS,
  customSlots,
  type CloudflareCustomRule,
  type RuleAction,
  type RuleDraft,
  type SkipComponent,
} from '../../lib/cloudflareRules'

const fieldClass =
  'mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50'

export interface RuleFormDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  draft: RuleDraft
  otherRules: CloudflareCustomRule[]
  onCancel: () => void
  onSubmit: (draft: RuleDraft) => void
}

interface FieldErrors {
  name?: string
  expression?: string
  skip?: string
}

function validate(draft: RuleDraft): FieldErrors {
  const errors: FieldErrors = {}
  if (!draft.name.trim()) {
    errors.name = 'Enter a rule name.'
  }
  if (!draft.expression.trim()) {
    errors.expression = 'Enter an expression.'
  } else if (draft.expression.trim().length > EXPRESSION_LIMIT) {
    errors.expression = `Expression must be ${EXPRESSION_LIMIT} characters or fewer.`
  }
  if (draft.action === 'skip' && draft.skip.length === 0) {
    errors.skip = 'Choose at least one component to skip.'
  }
  return errors
}

export function RuleFormDialog({
  open,
  mode,
  draft,
  otherRules,
  onCancel,
  onSubmit,
}: RuleFormDialogProps) {
  const titleId = useId()
  const nameId = useId()
  const expressionId = useId()
  const actionId = useId()
  const orderId = useId()
  const nameRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState(draft)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [moreOpen, setMoreOpen] = useState(
    draft.skip.some((item) => SKIP_OPTIONS.some((option) => option.value === item && option.group === 'more')),
  )
  const [editingExpression, setEditingExpression] = useState(draft.expression.trim() === '')

  useEffect(() => {
    if (!open) {
      return
    }
    nameRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onCancel])

  if (!open) {
    return null
  }

  const actionHint = ACTION_OPTIONS.find((option) => option.value === form.action)?.hint
  const mainSkip = SKIP_OPTIONS.filter((option) => option.group === 'main')
  const moreSkip = SKIP_OPTIONS.filter((option) => option.group === 'more')

  function update(patch: Partial<RuleDraft>) {
    setForm((current) => ({ ...current, ...patch }))
  }

  function toggleSkip(value: SkipComponent) {
    setForm((current) => {
      const selected = current.skip.includes(value)
      return {
        ...current,
        skip: selected ? current.skip.filter((item) => item !== value) : [...current.skip, value],
      }
    })
  }

  function onOrderKind(kind: 'first' | 'last' | 'custom') {
    if (kind === 'custom') {
      const position =
        form.placement.kind === 'custom' ? form.placement.position : Math.max(otherRules.length, 1)
      update({ placement: { kind: 'custom', position } })
      return
    }
    update({ placement: { kind } })
  }

  const slots = customSlots(otherRules)
  const expressionCount = form.expression.length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-pointer bg-background/80"
        aria-label="Dismiss dialog"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-4xl overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-lg"
      >
        <h2 id={titleId} className="text-base font-semibold">
          {mode === 'create' ? 'Add rule' : 'Edit rule'}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Custom rule for this domain. The expression is sent to Cloudflare as written.
        </p>

        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const nextErrors = validate(form)
            setErrors(nextErrors)
            if (Object.keys(nextErrors).length > 0) {
              return
            }
            onSubmit({
              ...form,
              name: form.name.trim(),
              expression: form.expression.trim(),
            })
          }}
        >
          <div>
            <label htmlFor={nameId} className="block text-sm font-medium">
              Rule name
            </label>
            <input
              ref={nameRef}
              id={nameId}
              value={form.name}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${nameId}-error` : `${nameId}-hint`}
              className={fieldClass}
              onChange={(event) => update({ name: event.target.value })}
            />
            <p id={`${nameId}-hint`} className="mt-1 text-sm text-muted-foreground">
              Give your rule a descriptive name.
            </p>
            {errors.name ? (
              <p id={`${nameId}-error`} className="mt-1 text-sm text-destructive" role="alert">
                {errors.name}
              </p>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={expressionId} className="text-sm font-medium">
                {editingExpression ? 'Expression' : 'Expression preview'}
              </label>
              {editingExpression ? (
                <button
                  type="button"
                  className="cursor-pointer text-sm font-medium text-accent transition-opacity duration-200 hover:opacity-80"
                  onClick={() => setEditingExpression(false)}
                >
                  Show preview
                </button>
              ) : (
                <button
                  type="button"
                  className="cursor-pointer text-sm font-medium text-accent transition-opacity duration-200 hover:opacity-80"
                  onClick={() => setEditingExpression(true)}
                >
                  Edit expression
                </button>
              )}
            </div>
            {editingExpression ? (
              <textarea
                id={expressionId}
                rows={Math.min(12, Math.max(4, form.expression.split('\n').length + 2))}
                value={form.expression}
                maxLength={EXPRESSION_LIMIT}
                aria-invalid={errors.expression ? true : undefined}
                aria-describedby={
                  errors.expression ? `${expressionId}-error ${expressionId}-count` : `${expressionId}-count`
                }
                className={`${fieldClass} font-mono text-xs leading-5`}
                onChange={(event) => update({ expression: event.target.value })}
              />
            ) : (
              <pre
                id={expressionId}
                className="mt-1 whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-5 text-foreground"
              >
                {form.expression || 'No expression yet.'}
              </pre>
            )}
            <p id={`${expressionId}-count`} className="mt-1 text-right text-xs text-muted-foreground">
              {expressionCount} / {EXPRESSION_LIMIT} characters
            </p>
            {errors.expression ? (
              <p id={`${expressionId}-error`} className="mt-1 text-sm text-destructive" role="alert">
                {errors.expression}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor={actionId} className="block text-sm font-medium">
              Action
            </label>
            <select
              id={actionId}
              value={form.action}
              className={fieldClass}
              onChange={(event) => {
                const action = event.target.value as RuleAction
                update(action === 'skip' ? { action } : { action, skip: [] })
              }}
            >
              {ACTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {actionHint ? <p className="mt-1 text-sm text-muted-foreground">{actionHint}</p> : null}
          </div>

          {form.action === 'skip' ? (
            <fieldset className="space-y-2 rounded-md border border-border p-3">
              <legend className="px-1 text-sm font-medium">Skip</legend>
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
                <span className="text-sm">
                  <span className="block font-medium">Log matching requests</span>
                  <span className="text-muted-foreground">
                    When off, matches stay out of Security Events.
                  </span>
                </span>
                <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                  <input
                    type="checkbox"
                    role="switch"
                    className="peer sr-only"
                    checked={form.logging}
                    aria-label="Log matching requests"
                    onChange={(event) => update({ logging: event.target.checked })}
                  />
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full border border-border bg-muted transition-colors duration-200 peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-0.5 size-5 rounded-full bg-background shadow-sm transition-transform duration-200 peer-checked:translate-x-5"
                  />
                </span>
              </label>

              <div className="space-y-1">
                <p className="text-sm font-medium">WAF components to skip</p>
                {mainSkip.map((option) => (
                  <label key={option.value} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-accent"
                      checked={form.skip.includes(option.value)}
                      onChange={() => toggleSkip(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
                <button
                  type="button"
                  className="inline-flex cursor-pointer items-center gap-1 py-1 text-sm font-medium text-foreground transition-colors duration-200 hover:text-accent"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  More components to skip
                  {moreOpen ? (
                    <CaretUp weight="regular" aria-hidden className="size-4" />
                  ) : (
                    <CaretDown weight="regular" aria-hidden className="size-4" />
                  )}
                </button>
                {moreOpen
                  ? moreSkip.map((option) => (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-2 py-1 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="size-4 accent-accent"
                          checked={form.skip.includes(option.value)}
                          onChange={() => toggleSkip(option.value)}
                        />
                        {option.label}
                      </label>
                    ))
                  : null}
                {errors.skip ? (
                  <p className="text-sm text-destructive" role="alert">
                    {errors.skip}
                  </p>
                ) : null}
              </div>
            </fieldset>
          ) : null}

          <div>
            <label htmlFor={orderId} className="block text-sm font-medium">
              Order
            </label>
            <p className="text-sm text-muted-foreground">
              Rules run from top to bottom. This sets where the rule sits in that list.
            </p>
            <select
              id={orderId}
              value={form.placement.kind}
              className={fieldClass}
              onChange={(event) => onOrderKind(event.target.value as 'first' | 'last' | 'custom')}
            >
              <option value="first">First</option>
              <option value="last">Last</option>
              <option value="custom">Custom</option>
            </select>
            {form.placement.kind === 'custom' ? (
              <div className="mt-3">
                <label htmlFor={`${orderId}-position`} className="block text-sm font-medium">
                  Position
                </label>
                <p id={`${orderId}-position-hint`} className="text-sm text-muted-foreground">
                  Pick any slot in the list, including between existing rules.
                </p>
                <select
                  id={`${orderId}-position`}
                  value={form.placement.position}
                  aria-describedby={`${orderId}-position-hint`}
                  className={fieldClass}
                  onChange={(event) =>
                    update({ placement: { kind: 'custom', position: Number(event.target.value) } })
                  }
                >
                  {slots.map((slot) => (
                    <option key={slot.position} value={slot.position}>
                      {slot.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Status</legend>
            <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
              <input
                type="radio"
                name="rule-status"
                checked={form.enabled}
                onChange={() => update({ enabled: true })}
              />
              Active
            </label>
            <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
              <input
                type="radio"
                name="rule-status"
                checked={!form.enabled}
                onChange={() => update({ enabled: false })}
              />
              Disabled
            </label>
          </fieldset>

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-accent px-3 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90"
            >
              Save rule
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
