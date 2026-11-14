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
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
} from '../ui'

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
  }, [open])

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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          onCancel()
        }
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-4xl overflow-y-auto"
        role="dialog"
        aria-labelledby={titleId}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          nameRef.current?.focus()
        }}
      >
        <DialogTitle id={titleId}>{mode === 'create' ? 'Add rule' : 'Edit rule'}</DialogTitle>
        <DialogDescription>
          Custom rule for this domain. The expression is sent to Cloudflare as written.
        </DialogDescription>

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
          <Field
            label="Rule name"
            hint="Give your rule a descriptive name."
            error={errors.name}
          >
            {(props) => (
              <Input
                {...props}
                ref={nameRef}
                value={form.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            )}
          </Field>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={expressionId} className="text-sm font-medium">
                {editingExpression ? 'Expression' : 'Expression preview'}
              </label>
              {editingExpression ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0 text-accent hover:bg-transparent"
                  onClick={() => setEditingExpression(false)}
                >
                  Show preview
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0 text-accent hover:bg-transparent"
                  onClick={() => setEditingExpression(true)}
                >
                  Edit expression
                </Button>
              )}
            </div>
            {editingExpression ? (
              <Textarea
                id={expressionId}
                rows={Math.min(12, Math.max(4, form.expression.split('\n').length + 2))}
                value={form.expression}
                maxLength={EXPRESSION_LIMIT}
                aria-invalid={errors.expression ? true : undefined}
                aria-describedby={
                  errors.expression ? `${expressionId}-error ${expressionId}-count` : `${expressionId}-count`
                }
                className="mt-1 font-mono text-xs leading-5"
                onChange={(event) => update({ expression: event.target.value })}
              />
            ) : (
              <pre
                id={expressionId}
                className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-5 text-foreground"
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

          <div className="space-y-1.5">
            <label htmlFor={actionId} className="text-sm font-medium text-foreground">
              Action
            </label>
            <Select
              id={actionId}
              value={form.action}
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
            </Select>
            {actionHint ? <p className="text-sm text-muted-foreground">{actionHint}</p> : null}
          </div>

          {form.action === 'skip' ? (
            <fieldset className="space-y-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-medium">Skip</legend>
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
                <span className="text-sm">
                  <span className="block font-medium">Log matching requests</span>
                  <span className="text-muted-foreground">
                    When off, matches stay out of Security Events.
                  </span>
                </span>
                <Switch
                  checked={form.logging}
                  aria-label="Log matching requests"
                  onCheckedChange={(checked) => update({ logging: checked })}
                />
              </label>

              <div className="space-y-1">
                <p className="text-sm font-medium">WAF components to skip</p>
                {mainSkip.map((option) => (
                  <label key={option.value} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                    <Checkbox
                      checked={form.skip.includes(option.value)}
                      onChange={() => toggleSkip(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-0"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((value) => !value)}
                >
                  More components to skip
                  {moreOpen ? (
                    <CaretUp weight="regular" aria-hidden className="size-4" />
                  ) : (
                    <CaretDown weight="regular" aria-hidden className="size-4" />
                  )}
                </Button>
                {moreOpen
                  ? moreSkip.map((option) => (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-2 py-1 text-sm"
                      >
                        <Checkbox
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

          <div className="space-y-1.5">
            <label htmlFor={orderId} className="text-sm font-medium text-foreground">
              Order
            </label>
            <p className="text-sm text-muted-foreground">
              Rules run from top to bottom. This sets where the rule sits in that list.
            </p>
            <Select
              id={orderId}
              value={form.placement.kind}
              onChange={(event) => onOrderKind(event.target.value as 'first' | 'last' | 'custom')}
            >
              <option value="first">First</option>
              <option value="last">Last</option>
              <option value="custom">Custom</option>
            </Select>
            {form.placement.kind === 'custom' ? (
              <div className="mt-3 space-y-1.5">
                <label htmlFor={`${orderId}-position`} className="text-sm font-medium text-foreground">
                  Position
                </label>
                <p id={`${orderId}-position-hint`} className="text-sm text-muted-foreground">
                  Pick any slot in the list, including between existing rules.
                </p>
                <Select
                  id={`${orderId}-position`}
                  value={form.placement.position}
                  aria-describedby={`${orderId}-position-hint`}
                  onChange={(event) =>
                    update({ placement: { kind: 'custom', position: Number(event.target.value) } })
                  }
                >
                  {slots.map((slot) => (
                    <option key={slot.position} value={slot.position}>
                      {slot.label}
                    </option>
                  ))}
                </Select>
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
            <Button type="button" variant="secondary" className="min-h-11" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" className="min-h-11">
              Save rule
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}