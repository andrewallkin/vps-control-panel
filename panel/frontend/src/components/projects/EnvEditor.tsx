import { Plus, Trash } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import {
  applyEnvPaste,
  type EnvRow,
  envRowsToUserEnv,
  generateSecret,
  isEnvKeyLocked,
} from '../../lib/envEditorUtils'

export type { EnvRow }

export interface EnvEditorProps {
  rows: EnvRow[]
  routePortEnvVars: string[]
  onChange: (rows: EnvRow[], userEnv: string) => void
}

export function EnvEditor({ rows, routePortEnvVars, onChange }: EnvEditorProps) {
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
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => setPasteOpen((open) => !open)}
        >
          Paste .env
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => emit([...rows, { key: '', value: '', locked: false }])}
        >
          <span className="inline-flex items-center gap-2">
            <Plus weight="regular" aria-hidden className="size-4" />
            Add variable
          </span>
        </button>
      </div>

      {pasteOpen ? (
        <div className="space-y-2 rounded-md border border-border bg-card p-4">
          <label className="block text-sm font-medium" htmlFor="env-paste">
            Paste .env
          </label>
          <textarea
            id="env-paste"
            rows={5}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground transition-colors duration-200"
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
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={applyPaste}
          >
            Apply paste
          </button>
        </div>
      ) : null}

      <ul className="space-y-3">
        {rows.map((row, index) => {
          return (
            <li
              key={index}
              className="grid grid-cols-1 items-center gap-2 rounded-md border border-border bg-card p-3 sm:grid-cols-[13rem_minmax(0,1fr)_12.5rem]"
            >
              <button
                type="button"
                aria-label={row.key ? `${row.key} key` : 'New key'}
                className="h-10 min-w-0 truncate rounded-md border border-border bg-background px-3 text-left font-mono text-sm text-foreground transition-colors duration-200 hover:border-accent cursor-pointer"
                onClick={() => setExpanded({ index, field: 'key' })}
              >
                {row.key || <span className="text-muted-foreground">KEY</span>}
              </button>
              <button
                type="button"
                aria-label={row.key || 'Value'}
                className="h-10 min-w-0 truncate rounded-md border border-border bg-background px-3 text-left font-mono text-sm text-foreground transition-colors duration-200 hover:border-accent cursor-pointer"
                onClick={() => setExpanded({ index, field: 'value' })}
              >
                {row.value || <span className="text-muted-foreground">Value</span>}
              </button>
              <div className="flex h-10 items-center justify-end gap-2">
                {!row.locked ? (
                  <>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => updateRow(index, { value: generateSecret() })}
                    >
                      Generate secret
                    </button>
                    <button
                      type="button"
                      className="rounded-md p-2 transition-colors duration-200 hover:bg-muted cursor-pointer"
                      onClick={() => removeRow(index)}
                    >
                      <Trash weight="regular" aria-hidden className="size-4" />
                      <span className="sr-only">Remove {row.key}</span>
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">Managed</span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {expanded !== null && rows[expanded.index] ? (
        <EnvValueDialog
          row={rows[expanded.index]!}
          field={expanded.field}
          onChangeKey={(value) => updateRow(expanded.index, { key: value.toUpperCase() })}
          onChangeValue={(value) => updateRow(expanded.index, { value })}
          onClose={() => setExpanded(null)}
        />
      ) : null}

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
  row,
  field,
  onChangeKey,
  onChangeValue,
  onClose,
}: {
  row: EnvRow
  field: 'key' | 'value'
  onChangeKey: (value: string) => void
  onChangeValue: (value: string) => void
  onClose: () => void
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fieldRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const label = field === 'key' ? 'Full key' : 'Full value'
  const value = field === 'key' ? row.key : row.value

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-background/80 cursor-pointer"
        aria-label="Dismiss dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative z-10 w-full max-w-3xl rounded-lg border border-border bg-card p-4 shadow-lg"
      >
        <label className="block text-sm font-medium" htmlFor="env-full-field">
          {row.key || 'New variable'}
        </label>
        <textarea
          id="env-full-field"
          ref={fieldRef}
          aria-label={label}
          readOnly={row.locked}
          rows={field === 'value' ? 8 : 3}
          className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground transition-colors duration-200 read-only:opacity-80"
          value={value}
          onChange={(event) =>
            field === 'key' ? onChangeKey(event.target.value) : onChangeValue(event.target.value)
          }
        />
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background transition-opacity duration-200 hover:opacity-90 cursor-pointer"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
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
