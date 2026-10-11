import { formatPushedAtRelative } from '../../lib/format'
import type { RegistryTagOption } from '../../lib/projectDeployTypes'

export interface TagPickerProps {
  tags: RegistryTagOption[]
  selectedName: string
  onSelectedNameChange: (name: string) => void
  now?: number
}

function normalizeTags(tags: RegistryTagOption[] | string[]): RegistryTagOption[] {
  return tags.map((tag) => {
    if (typeof tag === 'string') {
      return { name: tag, sha: '', pushed_at: null }
    }
    return tag
  })
}

export function TagPicker({
  tags,
  selectedName,
  onSelectedNameChange,
  now = Date.now(),
}: TagPickerProps) {
  const options = normalizeTags(tags)
  const selected = options.find((tag) => tag.name === selectedName) ?? options[0]

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor="tag-picker-select">
        Image tag
      </label>
      <select
        id="tag-picker-select"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
        value={selected?.name ?? ''}
        onChange={(event) => onSelectedNameChange(event.target.value)}
      >
        {options.map((tag) => (
          <option key={tag.name} value={tag.name}>
            {tag.name}
          </option>
        ))}
      </select>
      {selected ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-mono text-foreground">{selected.sha || '—'}</span>
          {selected.pushed_at ? (
            <>
              {' · '}
              {formatPushedAtRelative(selected.pushed_at, now)}
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
