import { Plus, Trash } from '@phosphor-icons/react'
import type { RouteDraft, RoutesValidationResult } from '../../lib/routeValidation'
import { validateRoutes } from '../../lib/routeValidation'

export interface RouteEditorProps {
  routes: RouteDraft[]
  onChange: (routes: RouteDraft[]) => void
  onValidationChange?: (result: RoutesValidationResult) => void
}

export function RouteEditor({ routes, onChange, onValidationChange }: RouteEditorProps) {
  function emit(next: RouteDraft[]) {
    onChange(next)
    onValidationChange?.(validateRoutes(next))
  }

  function updateRoute(index: number, patch: Partial<RouteDraft>) {
    emit(routes.map((route, i) => (i === index ? { ...route, ...patch } : route)))
  }

  function addRoute() {
    emit([...routes, { path_prefix: '/', port_env_var: '' }])
  }

  function removeRoute(index: number) {
    if (routes.length <= 1) {
      return
    }
    emit(routes.filter((_, i) => i !== index))
  }

  const validation = validateRoutes(routes)

  return (
    <div className="space-y-4">
      {routes.map((route, index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 sm:flex-row sm:items-end"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <label className="text-sm font-medium" htmlFor={`route-path-${index}`}>
              Path prefix
            </label>
            <input
              id={`route-path-${index}`}
              type="text"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
              value={route.path_prefix}
              onChange={(event) => updateRoute(index, { path_prefix: event.target.value })}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <label className="text-sm font-medium" htmlFor={`route-port-${index}`}>
              Port env var
            </label>
            <input
              id={`route-port-${index}`}
              type="text"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
              value={route.port_env_var}
              onChange={(event) => updateRoute(index, { port_env_var: event.target.value })}
            />
          </div>
          <button
            type="button"
            disabled={routes.length <= 1}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors duration-200 hover:bg-muted disabled:opacity-50 cursor-pointer"
            onClick={() => removeRoute(index)}
          >
            <Trash weight="regular" aria-hidden className="size-4" />
            Remove
          </button>
        </div>
      ))}

      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors duration-200 hover:bg-muted cursor-pointer"
        onClick={addRoute}
      >
        <Plus weight="regular" aria-hidden className="size-4" />
        Add route
      </button>

      {!validation.ok ? (
        <p className="text-sm text-destructive" role="alert">
          {validation.error}
        </p>
      ) : null}
    </div>
  )
}
