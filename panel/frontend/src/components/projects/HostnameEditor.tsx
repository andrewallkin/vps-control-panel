import { Plus, Trash } from '@phosphor-icons/react'
import type { ProjectHostname } from '../../lib/projectsApi'

export interface HostnameEditorProps {
  hostnames: ProjectHostname[]
  domains: string[]
  onChange: (hostnames: ProjectHostname[]) => void
}

export function HostnameEditor({ hostnames, domains, onChange }: HostnameEditorProps) {
  const primaryIndex = hostnames.findIndex((row) => row.kind === 'primary')
  const primary = primaryIndex >= 0 ? hostnames[primaryIndex]! : null
  const extras = hostnames.filter((row) => row.kind !== 'primary')

  function updatePrimary(patch: Partial<ProjectHostname>) {
    if (!primary) {
      return
    }
    const next = hostnames.map((row, index) =>
      index === primaryIndex ? { ...row, ...patch, kind: 'primary' as const } : row,
    )
    onChange(next)
  }

  function updateExtra(index: number, patch: Partial<ProjectHostname>) {
    const target = extras[index]
    if (!target) {
      return
    }
    const next = hostnames.map((row) => (row === target ? { ...row, ...patch } : row))
    onChange(next)
  }

  function removeExtra(index: number) {
    const target = extras[index]
    if (!target) {
      return
    }
    onChange(hostnames.filter((row) => row !== target))
  }

  function addExtra() {
    onChange([
      ...hostnames,
      { domain: domains[0] ?? '', subdomain: '', kind: 'alias' },
    ])
  }

  return (
    <div className="space-y-4">
      {primary ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-sm font-medium" htmlFor="primary-domain">
              Primary domain
            </label>
            <select
              id="primary-domain"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200"
              value={primary.domain}
              onChange={(event) => updatePrimary({ domain: event.target.value })}
            >
              {domains.map((domain) => (
                <option key={domain} value={domain}>
                  {domain}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium" htmlFor="primary-subdomain">
              Subdomain
            </label>
            <input
              id="primary-subdomain"
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200"
              value={primary.subdomain}
              onChange={(event) => updatePrimary({ subdomain: event.target.value })}
            />
          </div>
        </div>
      ) : null}
      <div className="space-y-3">
        <p className="text-sm font-medium">Extra hostnames</p>
        {extras.map((row, index) => (
          <div key={`${row.domain}-${index}`} className="grid gap-2 sm:grid-cols-4">
            <select
              aria-label={`Extra domain ${index + 1}`}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200 sm:col-span-2"
              value={row.domain}
              onChange={(event) => updateExtra(index, { domain: event.target.value })}
            >
              {domains.map((domain) => (
                <option key={domain} value={domain}>
                  {domain}
                </option>
              ))}
            </select>
            <input
              aria-label={`Extra subdomain ${index + 1}`}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200"
              value={row.subdomain}
              onChange={(event) => updateExtra(index, { subdomain: event.target.value })}
            />
            <div className="flex gap-2">
              <select
                aria-label={`Extra kind ${index + 1}`}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors duration-200"
                value={row.kind}
                onChange={(event) =>
                  updateExtra(index, {
                    kind: event.target.value as 'alias' | 'redirect',
                  })
                }
              >
                <option value="alias">Alias</option>
                <option value="redirect">Redirect</option>
              </select>
              <button
                type="button"
                className="rounded-md p-2 transition-colors duration-200 hover:bg-muted cursor-pointer"
                onClick={() => removeExtra(index)}
              >
                <Trash weight="regular" aria-hidden className="size-4" />
                <span className="sr-only">Remove hostname</span>
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={addExtra}
        >
          <Plus weight="regular" aria-hidden className="size-4" />
          Add hostname
        </button>
      </div>
    </div>
  )
}
