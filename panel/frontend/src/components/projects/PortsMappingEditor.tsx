import type { PortDraft, UsedPortRow } from '../../lib/portMappings'
import { parsePortDraft } from '../../lib/portMappings'

function rowHint(
  draft: PortDraft,
  usedPorts: UsedPortRow[],
  selfSlug: string | null,
): { text: string; tone: 'free' | 'taken' | 'current' } | null {
  const port = parsePortDraft(draft.host_port)
  if (port === null) {
    return null
  }
  const holder = usedPorts.find((row) => row.port === port)
  if (holder === undefined) {
    return { text: 'free', tone: 'free' }
  }
  if (holder.owner === selfSlug && holder.env_var === draft.env_var) {
    return { text: 'current', tone: 'current' }
  }
  if (holder.owner !== null && holder.env_var !== null) {
    return { text: `used by ${holder.owner} (${holder.env_var})`, tone: 'taken' }
  }
  return { text: 'in use on this server', tone: 'taken' }
}

const TONE_CLASS: Record<'free' | 'taken' | 'current', string> = {
  free: 'text-muted-foreground',
  taken: 'text-destructive',
  current: 'text-muted-foreground',
}

export interface PortsMappingEditorProps {
  rows: PortDraft[]
  usedPorts: UsedPortRow[]
  selfSlug: string | null
  onChange: (rows: PortDraft[]) => void
}

export function PortsMappingEditor({
  rows,
  usedPorts,
  selfSlug,
  onChange,
}: PortsMappingEditorProps) {
  function updateRow(index: number, patch: Partial<PortDraft>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Each port mapping binds one compose service port on the host. Routing forwards to these
        ports. Changing a port takes effect on the next deploy.
      </p>
      <div className="space-y-2">
        {rows.map((row, index) => {
          const hint = rowHint(row, usedPorts, selfSlug)
          return (
            <div
              key={row.env_var}
              className="grid items-center gap-2 rounded-md border border-border bg-card p-3 sm:grid-cols-[minmax(10rem,1fr)_8rem_minmax(8rem,1fr)]"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-foreground">{row.env_var}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.service ? `${row.service} · ` : ''}
                  {row.default !== null ? `compose default ${row.default}` : 'no compose default'}
                </p>
              </div>
              <div>
                <label className="sr-only" htmlFor={`port-${row.env_var}`}>
                  {row.env_var} host port
                </label>
                <input
                  id={`port-${row.env_var}`}
                  type="text"
                  inputMode="numeric"
                  placeholder="Host port"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground transition-colors duration-200"
                  value={row.host_port}
                  onChange={(event) => updateRow(index, { host_port: event.target.value })}
                />
              </div>
              <div className="min-w-0">
                {hint !== null ? (
                  <span className={`text-xs ${TONE_CLASS[hint.tone]}`} role="status">
                    {hint.text}
                  </span>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
