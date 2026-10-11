import { Plus, Trash } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import {
  applyEnvPaste,
  type EnvRow,
  envRowsToUserEnv,
  generateSecret,
  isEnvKeyLocked,
  maskEnvValue,
} from '../../lib/envEditorUtils'

export interface EnvEditorProps {
  rows: EnvRow[]
  routePortEnvVars: string[]
  onChange: (rows: EnvRow[], userEnv: string) => void
}

export function EnvEditor({ rows, routePortEnvVars, onChange }: EnvEditorProps) {
  const [localRows, setLocalRows] = useState(rows)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [invalidPasteLines, setInvalidPasteLines] = useState<string[]>([])
  const [focusedKey, setFocusedKey] = useState<string | null>(null)

  useEffect(() => {
    setLocalRows(rows)
  }, [rows])

  function emit(nextRows: EnvRow[]) {
    setLocalRows(nextRows)
    onChange(nextRows, envRowsToUserEnv(nextRows))
  }

  function updateRow(index: number, patch: Partial<EnvRow>) {
    emit(
      localRows.map((row, i) => {
        if (i !== index) {
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
    const row = localRows[index]
    if (!row || row.locked) {
      return
    }
    emit(localRows.filter((_, i) => i !== index))
  }

  function addRow() {
    emit([...localRows, { key: '', value: '', locked: false }])
  }

  function applyPaste() {
    const { rows: next, invalidLines } = applyEnvPaste(localRows, pasteText, routePortEnvVars)
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
          className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer"
          onClick={() => setPasteOpen((open) => !open)}
        >
          Paste .env
        </button>
        <button
          type="button"
          className="rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer"
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
          <label className="text-sm font-medium" htmlFor="env-paste">
            Paste .env
          </label>
          <textarea
            id="env-paste"
            rows={5}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
          />
          {invalidPasteLines.length > 0 ? (
            <ul className="list-inside list-disc text-sm text-destructive">
              {invalidPasteLines.map((line) => (
                <li key={line}>{line.trim() || '(blank line)'}</li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-background cursor-pointer"
            onClick={applyPaste}
          >
            Apply paste
          </button>
        </div>
      ) : null}

      <ul className="space-y-3">
        {localRows.map((row, index) => {
          const focused = focusedKey === row.key
          const displayValue = row.locked ? row.value : maskEnvValue(row.value, focused)
          return (
            <li
              key={`${row.key}-${index}`}
              className="flex flex-col gap-2 rounded-md border border-border bg-card p-3 sm:flex-row sm:items-center"
            >
              <input
                aria-label={row.key ? `${row.key} key` : 'New key'}
                type="text"
                readOnly={row.locked}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm read-only:opacity-80"
                value={row.key}
                placeholder="KEY"
                onChange={(event) => updateRow(index, { key: event.target.value.toUpperCase() })}
              />
              <input
                aria-label={row.key || 'Value'}
                type="text"
                readOnly={row.locked}
                autoComplete="off"
                className="min-w-0 flex-[2] rounded-md border border-border bg-background px-3 py-2 font-mono text-sm read-only:opacity-80"
                value={displayValue}
                onFocus={() => setFocusedKey(row.key)}
                onBlur={() => setFocusedKey(null)}
                onChange={(event) => updateRow(index, { value: event.target.value })}
              />
              {!row.locked ? (
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted cursor-pointer"
                    onClick={() => updateRow(index, { value: generateSecret() })}
                  >
                    Generate secret
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border p-2 text-muted-foreground hover:bg-muted cursor-pointer"
                    onClick={() => removeRow(index)}
                  >
                    <Trash weight="regular" aria-hidden className="size-4" />
                    <span className="sr-only">Remove {row.key}</span>
                  </button>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">Managed</span>
              )}
            </li>
          )
        })}
      </ul>

      {localRows.length === 0 ? (
        <button
          type="button"
          className="text-sm text-accent underline cursor-pointer"
          onClick={addRow}
        >
          Add your first variable
        </button>
      ) : null}
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
