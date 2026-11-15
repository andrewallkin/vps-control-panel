import { Plus, Trash } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  IconButton,
  Textarea,
} from '../ui'
import {
  applyEnvPaste,
  type EnvRow,
  envRowsToUserEnv,
  generateSecret,
  isEnvKeyLocked,
  isMaskedEnvPlaceholder,
} from '../../lib/envEditorUtils'

export type { EnvRow }

export interface EnvEditorProps {
  rows: EnvRow[]
  routePortEnvVars: string[]
  onChange: (rows: EnvRow[], userEnv: string) => void
  /** Load the unmasked value for a key. The list keeps the masked preview. */
  onRevealValue?: (key: string) => Promise<string>
}

export function EnvEditor({ rows, routePortEnvVars, onChange, onRevealValue }: EnvEditorProps) {
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [invalidPasteLines, setInvalidPasteLines] = useState<string[]>([])
  const [expanded, setExpanded] = useState<{ index: number; field: 'key' | 'value' } | null>(
    null,
  )

  function emit(nextRows: EnvRow[]) {
    onChange(nextRows, envRowsToUserEnv(nextRows))
  }

  function updateRow(index: number, patch: Partial<EnvRow>) {
    emit(
      rows.map((row, i) => {
        if (i !== index) {
          return row
        }
        // Renaming a row onto a managed key must not take effect: the server
        // rejects managed keys and the lock model is keyed on the row's key.
        if (patch.key !== undefined && isEnvKeyLocked(patch.key, routePortEnvVars)) {
          return row
        }
        const next = { ...row, ...patch }
        if (!row.locked && (patch.value !== undefined || patch.key !== undefined)) {
          // A key change records the original key so a rename can preserve the
          // stored value: the masked placeholder cannot be written to the .env.
          if (patch.key !== undefined && patch.key !== row.key) {
            next.renamedFrom = row.renamedFrom ?? row.key
          }
          return { ...next, edited: true }
        }
        return next
      }),
    )
  }

  function removeRow(index: number) {
    const row = rows[index]
    if (!row || row.locked) {
      return
    }
    emit(rows.filter((_, i) => i !== index))
  }

  function addRow() {
    emit([...rows, { key: '', value: '', locked: false, edited: true }])
  }

  function applyPaste() {
    const { rows: next, invalidLines } = applyEnvPaste(rows, pasteText, routePortEnvVars)
    setInvalidPasteLines(invalidLines)
    emit(next)
    if (invalidLines.length === 0) {
      setPasteOpen(false)
      setPasteText('')
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => setPasteOpen((open) => !open)}>
          Paste .env
        </Button>
        <Button
          type="button"
          variant="secondary"
          leftIcon={<Plus weight="regular" aria-hidden className="size-4" />}
          onClick={() => emit([...rows, { key: '', value: '', locked: false }])}
        >
          Add variable
        </Button>
      </div>

      {pasteOpen ? (
        <Card className="space-y-2 p-4">
          <label className="block text-sm font-medium" htmlFor="env-paste">
            Paste .env
          </label>
          <Textarea
            id="env-paste"
            rows={5}
            mono
            className="mt-1"
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
          />
          {invalidPasteLines.length > 0 ? (
            <ul className="list-inside list-disc text-sm text-destructive" role="alert">
              {invalidPasteLines.map((line) => (
                <li key={line}>{line.trim() || '(blank line)'}</li>
              ))}
            </ul>
          ) : null}
          <Button type="button" onClick={applyPaste}>
            Apply paste
          </Button>
        </Card>
      ) : null}

      <ul className="min-w-0 space-y-3">
        {rows.map((row, index) => {
          return (
            <li key={index} className="min-w-0">
              <Card className="flex min-w-0 flex-wrap items-center gap-2 p-3">
              <button
                type="button"
                aria-label={row.key ? `${row.key} key` : 'New key'}
                className="h-10 w-full min-w-0 truncate rounded-lg border border-border-strong bg-background px-3 text-left font-mono text-sm text-foreground transition-colors duration-150 hover:border-accent cursor-pointer sm:w-52 sm:shrink-0"
                onClick={() => setExpanded({ index, field: 'key' })}
              >
                {row.key || <span className="text-muted-foreground">KEY</span>}
              </button>
              <button
                type="button"
                aria-label={row.key || 'Value'}
                className="h-10 min-w-0 flex-1 basis-40 truncate rounded-lg border border-border-strong bg-background px-3 text-left font-mono text-sm text-foreground transition-colors duration-150 hover:border-accent cursor-pointer"
                onClick={() => setExpanded({ index, field: 'value' })}
              >
                {row.value || <span className="text-muted-foreground">Value</span>}
              </button>
              <div className="flex h-10 min-w-0 items-center justify-end gap-2">
                {!row.locked ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => updateRow(index, { value: generateSecret() })}
                    >
                      Generate secret
                    </Button>
                    <IconButton
                      type="button"
                      label={`Remove ${row.key}`}
                      size="sm"
                      onClick={() => removeRow(index)}
                    >
                      <Trash weight="regular" aria-hidden className="size-4" />
                    </IconButton>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">Managed</span>
                )}
              </div>
              </Card>
            </li>
          )
        })}
      </ul>

      <EnvValueDialog
        key={expanded ? `${expanded.index}-${expanded.field}` : 'closed'}
        open={expanded !== null && rows[expanded?.index ?? -1] !== undefined}
        row={expanded !== null ? rows[expanded.index] : null}
        field={expanded?.field ?? 'value'}
        onChangeKey={(value) => {
          if (expanded === null) {
            return
          }
          updateRow(expanded.index, { key: value.toUpperCase() })
        }}
        onChangeValue={(value) => {
          if (expanded === null) {
            return
          }
          updateRow(expanded.index, { value })
        }}
        onRevealValue={onRevealValue}
        onClose={() => setExpanded(null)}
      />

      {rows.length === 0 ? (
        <button
          type="button"
          className="text-sm font-medium underline-offset-2 hover:underline cursor-pointer text-accent"
          onClick={addRow}
        >
          Add your first variable
        </button>
      ) : null}
    </div>
  )
}

function EnvValueDialog({
  open,
  row,
  field,
  onChangeKey,
  onChangeValue,
  onRevealValue,
  onClose,
}: {
  open: boolean
  row: EnvRow | null
  field: 'key' | 'value'
  onChangeKey: (value: string) => void
  onChangeValue: (value: string) => void
  onRevealValue?: (key: string) => Promise<string>
  onClose: () => void
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState(() => (field === 'key' ? row?.key ?? '' : row?.value ?? ''))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const id = window.requestAnimationFrame(() => fieldRef.current?.focus())
    return () => window.cancelAnimationFrame(id)
  }, [open, field])

  useEffect(() => {
    if (!open || !row || field !== 'value' || !onRevealValue || !isMaskedEnvPlaceholder(row.value)) {
      return
    }
    // After a rename the backend still stores the value under the original
    // key, so the reveal must look that key up, not the edited one.
    const lookupKey = row.renamedFrom ?? row.key
    let cancelled = false
    onRevealValue(lookupKey)
      .then((value) => {
        if (!cancelled) {
          setDraft(value)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load the full value.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [open, field, onRevealValue, row])

  if (!row) {
    return null
  }

  const label = field === 'key' ? 'Full key' : 'Full value'

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-3xl" aria-label={label}>
        <DialogTitle>{row.key || 'New variable'}</DialogTitle>
        <Textarea
          id="env-full-field"
          ref={fieldRef}
          aria-label={label}
          readOnly={row.locked}
          rows={field === 'value' ? 8 : 3}
          mono
          className="mt-2 resize-y read-only:opacity-80"
          value={draft}
          onChange={(event) => {
            const next = field === 'key' ? event.target.value.toUpperCase() : event.target.value
            setDraft(next)
            if (field === 'key') {
              onChangeKey(next)
            } else {
              onChangeValue(next)
            }
          }}
        />
        {error ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function buildDefaultEnvRows(
  databaseMode: 'none' | 'new' | 'adopted',
  dbName: string,
  dbUser: string,
  routePortEnvVars: string[],
  dockerImageKeys: string[],
): EnvRow[] {
  const rows: EnvRow[] = []
  if (databaseMode !== 'none') {
    rows.push(
      { key: 'POSTGRES_HOST', value: 'postgres-central', locked: true },
      { key: 'POSTGRES_PORT', value: '5432', locked: true },
      { key: 'POSTGRES_DB', value: dbName, locked: true },
      { key: 'POSTGRES_USER', value: dbUser, locked: true },
      { key: 'POSTGRES_PASSWORD', value: '', locked: true },
      { key: 'DATABASE_URL', value: '', locked: true },
    )
  }
  for (const key of routePortEnvVars) {
    if (!rows.some((r) => r.key === key)) {
      rows.push({ key, value: '', locked: true })
    }
  }
  for (const key of dockerImageKeys) {
    if (!rows.some((r) => r.key === key)) {
      rows.push({ key, value: '', locked: true })
    }
  }
  return rows
}

export function syncLockedEnvRows(
  rows: EnvRow[],
  databaseMode: 'none' | 'new' | 'adopted',
  dbName: string,
  dbUser: string,
  routePortEnvVars: string[],
  writeDatabaseUrl: boolean,
): EnvRow[] {
  const unlocked = rows.filter((row) => !row.locked)
  const managed = buildDefaultEnvRows(databaseMode, dbName, dbUser, routePortEnvVars, [])
  if (databaseMode !== 'none' && !writeDatabaseUrl) {
    return [...managed.filter((r) => r.key !== 'DATABASE_URL'), ...unlocked]
  }
  if (databaseMode === 'none') {
    const portOnly = routePortEnvVars.map((key) => ({
      key,
      value: rows.find((r) => r.key === key)?.value ?? '',
      locked: true,
    }))
    return [...portOnly, ...unlocked.filter((r) => !isEnvKeyLocked(r.key, routePortEnvVars))]
  }
  return [...managed, ...unlocked]
}
