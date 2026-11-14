import { Plus, Trash } from '@phosphor-icons/react'
import { Button, Card, Input } from '../ui'
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
        <Card
          key={index}
          className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <label className="block text-sm font-medium" htmlFor={`svc-name-${index}`}>
              Service name
            </label>
            <Input
              id={`svc-name-${index}`}
              type="text"
              mono
              className="mt-1"
              value={row.service_name}
              onChange={(event) => updateRow(index, { service_name: event.target.value })}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <label className="block text-sm font-medium" htmlFor={`svc-env-${index}`}>
              Image env var
            </label>
            <Input
              id={`svc-env-${index}`}
              type="text"
              placeholder="DOCKER_IMAGE_WEB"
              mono
              className="mt-1"
              value={row.image_env_var}
              onChange={(event) => updateRow(index, { image_env_var: event.target.value })}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <label className="block text-sm font-medium" htmlFor={`svc-prefix-${index}`}>
              Tag prefix
            </label>
            <Input
              id={`svc-prefix-${index}`}
              type="text"
              mono
              className="mt-1"
              value={row.tag_prefix}
              onChange={(event) => updateRow(index, { tag_prefix: event.target.value })}
            />
          </div>
          <Button
            type="button"
            variant="danger"
            size="sm"
            leftIcon={<Trash weight="regular" aria-hidden className="size-4" />}
            onClick={() => removeRow(index)}
          >
            Remove
          </Button>
        </Card>
      ))}
      <Button
        type="button"
        variant="secondary"
        leftIcon={<Plus weight="regular" aria-hidden className="size-4" />}
        onClick={addRow}
      >
        Add service
      </Button>
      {!validation.ok ? (
        <p className="text-sm text-destructive" role="alert">{validation.error}</p>
      ) : null}
    </div>
  )
}