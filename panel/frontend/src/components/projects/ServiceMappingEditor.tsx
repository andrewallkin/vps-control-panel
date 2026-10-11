import { Plus, Trash } from '@phosphor-icons/react'
import type { ServiceMappingRow } from '../../lib/serviceMappingUtils'
import { prepareServiceMappingRows } from '../../lib/serviceMappingUtils'

export interface ServiceMappingEditorProps {
  services: ServiceMappingRow[]
  onChange: (services: ServiceMappingRow[]) => void
  onValidationChange?: (ok: boolean, error: string | null) => void
}

export function ServiceMappingEditor({
  services,
  onChange,
  onValidationChange,
}: ServiceMappingEditorProps) {
  function emit(next: ServiceMappingRow[]) {
    onChange(next)
    const result = prepareServiceMappingRows(next)
    onValidationChange?.(result.ok, result.ok ? null : result.error)
  }

  function updateRow(index: number, patch: Partial<ServiceMappingRow>) {
    emit(services.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function addRow() {
    emit([...services, { service_name: '', image_env_var: '', tag_prefix: '' }])
  }

  function removeRow(index: number) {
    emit(services.filter((_, i) => i !== index))
  }

  const validation = prepareServiceMappingRows(services)

  return (
    <div className="space-y-3">
      {services.length === 0 ? (
        <p className="text-sm text-muted-foreground">No image services configured.</p>
      ) : null}
      {services.map((row, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 lg:flex-row lg:items-end"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <label className="text-sm font-medium" htmlFor={`svc-name-${index}`}>
              Service name
            </label>
            <input
              id={`svc-name-${index}`}
              type="text"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
              value={row.service_name}
              onChange={(event) => updateRow(index, { service_name: event.target.value })}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <label className="text-sm font-medium" htmlFor={`svc-env-${index}`}>
              Image env var
            </label>
            <input
              id={`svc-env-${index}`}
              type="text"
              placeholder="DOCKER_IMAGE_WEB"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
              value={row.image_env_var}
              onChange={(event) => updateRow(index, { image_env_var: event.target.value })}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <label className="text-sm font-medium" htmlFor={`svc-prefix-${index}`}>
              Tag prefix
            </label>
            <input
              id={`svc-prefix-${index}`}
              type="text"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
              value={row.tag_prefix}
              onChange={(event) => updateRow(index, { tag_prefix: event.target.value })}
            />
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors duration-200 hover:bg-muted cursor-pointer"
            onClick={() => removeRow(index)}
          >
            <Trash weight="regular" aria-hidden className="size-4" />
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted cursor-pointer"
        onClick={addRow}
      >
        <Plus weight="regular" aria-hidden className="size-4" />
        Add service
      </button>
      {!validation.ok ? (
        <p className="text-sm text-destructive">{validation.error}</p>
      ) : null}
    </div>
  )
}
