import { useId, useState } from 'react'
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

export function TagPicker({ tags, selectedName, onSelectedNameChange, now }: TagPickerProps) {
  const selectId = useId()
  const [mountedAt] = useState(() => Date.now())
  const clock = now ?? mountedAt
  const options = normalizeTags(tags)
  const selected = options.find((tag) => tag.name === selectedName) ?? options[0]

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium" htmlFor={selectId}>
        Image tag
      </label>
      <select
        id={selectId}
        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground transition-colors duration-200"
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
              {formatPushedAtRelative(selected.pushed_at, clock)}
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
