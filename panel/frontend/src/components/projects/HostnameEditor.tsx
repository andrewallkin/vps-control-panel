import { Plus, Trash } from '@phosphor-icons/react'
import { Button, IconButton, Input, Select } from '../ui'
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
            <Select
              id="primary-domain"
              className="mt-1"
              value={primary.domain}
              onChange={(event) => updatePrimary({ domain: event.target.value })}
            >
              {domains.map((domain) => (
                <option key={domain} value={domain}>
                  {domain}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium" htmlFor="primary-subdomain">
              Subdomain
            </label>
            <Input
              id="primary-subdomain"
              className="mt-1"
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
            <Select
              aria-label={`Extra domain ${index + 1}`}
              className="sm:col-span-2"
              value={row.domain}
              onChange={(event) => updateExtra(index, { domain: event.target.value })}
            >
              {domains.map((domain) => (
                <option key={domain} value={domain}>
                  {domain}
                </option>
              ))}
            </Select>
            <Input
              aria-label={`Extra subdomain ${index + 1}`}
              value={row.subdomain}
              onChange={(event) => updateExtra(index, { subdomain: event.target.value })}
            />
            <div className="flex gap-2">
              <Select
                aria-label={`Extra kind ${index + 1}`}
                className="min-w-0 flex-1"
                value={row.kind}
                onChange={(event) =>
                  updateExtra(index, {
                    kind: event.target.value as 'alias' | 'redirect',
                  })
                }
              >
                <option value="alias">Alias</option>
                <option value="redirect">Redirect</option>
              </Select>
              <IconButton
                type="button"
                label="Remove hostname"
                size="sm"
                onClick={() => removeExtra(index)}
              >
                <Trash weight="regular" aria-hidden className="size-4" />
              </IconButton>
            </div>
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={addExtra} leftIcon={<Plus weight="regular" aria-hidden className="size-4" />}>
          Add hostname
        </Button>
      </div>
    </div>
  )
}