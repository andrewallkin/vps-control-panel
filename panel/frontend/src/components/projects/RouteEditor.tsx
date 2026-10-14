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
    emit([
      ...routes,
      {
        path_prefix: '/',
        port_env_var: '',
        streaming: false,
        websocket: false,
        pass_authorization: false,
        max_body_mb: 25,
        read_timeout_s: 60,
        send_timeout_s: 60,
      },
    ])
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
      <p className="text-sm text-muted-foreground">
        Each route forwards one URL prefix to a compose port. The path is not rewritten, so{' '}
        <span className="font-mono text-foreground">/</span> matches every path. Port env var is
        that port&apos;s variable in the compose file, such as{' '}
        <span className="font-mono text-foreground">WEB_PORT</span>. Add another route only when a
        different prefix must use a different port, such as{' '}
        <span className="font-mono text-foreground">/api</span> and{' '}
        <span className="font-mono text-foreground">API_PORT</span>.
      </p>
      {routes.map((route, index) => (
        <div key={index} className="space-y-3 rounded-md border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(12rem,1fr)_auto] sm:items-end">
            <div className="min-w-0 space-y-1">
              <label className="block text-sm font-medium" htmlFor={`route-path-${index}`}>
                Path prefix
              </label>
              <input
                id={`route-path-${index}`}
                type="text"
                placeholder="/"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground transition-colors duration-200"
                value={route.path_prefix}
                onChange={(event) => updateRoute(index, { path_prefix: event.target.value })}
              />
            </div>
            <div className="min-w-0 space-y-1">
              <label className="block text-sm font-medium" htmlFor={`route-port-${index}`}>
                Port env var
              </label>
              <input
                id={`route-port-${index}`}
                type="text"
                placeholder="WEB_PORT"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground transition-colors duration-200"
                value={route.port_env_var}
                onChange={(event) => updateRoute(index, { port_env_var: event.target.value })}
              />
            </div>
            <button
              type="button"
              disabled={routes.length <= 1}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors duration-200 hover:bg-destructive/10 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => removeRoute(index)}
            >
              <Trash weight="regular" aria-hidden className="size-4" />
              Remove
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                id={`route-streaming-${index}`}
                type="checkbox"
                checked={route.streaming ?? false}
                onChange={(event) =>
                  updateRoute(index, { streaming: event.target.checked })
                }
              />
              Streaming
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                id={`route-websocket-${index}`}
                type="checkbox"
                checked={route.websocket ?? false}
                onChange={(event) =>
                  updateRoute(index, { websocket: event.target.checked })
                }
              />
              WebSocket
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                id={`route-auth-${index}`}
                type="checkbox"
                checked={route.pass_authorization ?? false}
                onChange={(event) =>
                  updateRoute(index, { pass_authorization: event.target.checked })
                }
              />
              Pass Authorization
            </label>
            <label className="flex items-center gap-2 text-sm">
              Max body (MB)
              <input
                id={`route-body-${index}`}
                type="number"
                min={1}
                max={10240}
                className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground transition-colors duration-200"
                value={route.max_body_mb ?? 25}
                onChange={(event) =>
                  updateRoute(index, { max_body_mb: Number(event.target.value) })
                }
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              Read timeout (s)
              <input
                id={`route-read-${index}`}
                type="number"
                min={1}
                max={3600}
                className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground transition-colors duration-200"
                value={route.read_timeout_s ?? 60}
                onChange={(event) =>
                  updateRoute(index, { read_timeout_s: Number(event.target.value) })
                }
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              Send timeout (s)
              <input
                id={`route-send-${index}`}
                type="number"
                min={1}
                max={3600}
                className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground transition-colors duration-200"
                value={route.send_timeout_s ?? 60}
                onChange={(event) =>
                  updateRoute(index, { send_timeout_s: Number(event.target.value) })
                }
              />
            </label>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
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
