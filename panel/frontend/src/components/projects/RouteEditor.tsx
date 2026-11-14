import { Plus, Trash } from '@phosphor-icons/react'
import { Button, Card, Checkbox, Input } from '../ui'
import type { RouteDraft, RoutesValidationResult } from '../../lib/routeValidation'
import { validateRoutes } from '../../lib/routeValidation'

export interface RouteEditorProps {
  routes: RouteDraft[]
  onChange: (routes: RouteDraft[]) => void
  onValidationChange?: (result: RoutesValidationResult) => void
  portEnvVarOptions?: string[]
}

export function RouteEditor({
  routes,
  onChange,
  onValidationChange,
  portEnvVarOptions,
}: RouteEditorProps) {
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
        <Card key={index} className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(8rem,1fr)_minmax(12rem,1fr)_auto] sm:items-end">
            <div className="min-w-0 space-y-1">
              <label className="block text-sm font-medium" htmlFor={`route-path-${index}`}>
                Path prefix
              </label>
              <Input
                id={`route-path-${index}`}
                type="text"
                placeholder="/"
                mono
                className="mt-1"
                value={route.path_prefix}
                onChange={(event) => updateRoute(index, { path_prefix: event.target.value })}
              />
            </div>
            <div className="min-w-0 space-y-1">
              <label className="block text-sm font-medium" htmlFor={`route-port-${index}`}>
                Port env var
              </label>
              <Input
                id={`route-port-${index}`}
                type="text"
                placeholder="WEB_PORT"
                list={portEnvVarOptions && portEnvVarOptions.length > 0 ? 'route-port-options' : undefined}
                mono
                className="mt-1"
                value={route.port_env_var}
                onChange={(event) => updateRoute(index, { port_env_var: event.target.value })}
              />
              {portEnvVarOptions && portEnvVarOptions.length > 0 ? (
                <datalist id="route-port-options">
                  {portEnvVarOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              ) : null}
            </div>
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={routes.length <= 1}
              leftIcon={<Trash weight="regular" aria-hidden className="size-4" />}
              onClick={() => removeRoute(index)}
            >
              Remove
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                id={`route-streaming-${index}`}
                checked={route.streaming ?? false}
                onChange={(event) =>
                  updateRoute(index, { streaming: event.target.checked })
                }
              />
              Streaming
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                id={`route-websocket-${index}`}
                checked={route.websocket ?? false}
                onChange={(event) =>
                  updateRoute(index, { websocket: event.target.checked })
                }
              />
              WebSocket
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                id={`route-auth-${index}`}
                checked={route.pass_authorization ?? false}
                onChange={(event) =>
                  updateRoute(index, { pass_authorization: event.target.checked })
                }
              />
              Pass Authorization
            </label>
            <label className="flex items-center gap-2 text-sm">
              Max body (MB)
              <Input
                id={`route-body-${index}`}
                type="number"
                min={1}
                max={10240}
                className="w-20"
                value={route.max_body_mb ?? 25}
                onChange={(event) =>
                  updateRoute(index, { max_body_mb: Number(event.target.value) })
                }
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              Read timeout (s)
              <Input
                id={`route-read-${index}`}
                type="number"
                min={1}
                max={3600}
                className="w-20"
                value={route.read_timeout_s ?? 60}
                onChange={(event) =>
                  updateRoute(index, { read_timeout_s: Number(event.target.value) })
                }
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              Send timeout (s)
              <Input
                id={`route-send-${index}`}
                type="number"
                min={1}
                max={3600}
                className="w-20"
                value={route.send_timeout_s ?? 60}
                onChange={(event) =>
                  updateRoute(index, { send_timeout_s: Number(event.target.value) })
                }
              />
            </label>
          </div>
        </Card>
      ))}

      <Button
        type="button"
        variant="secondary"
        leftIcon={<Plus weight="regular" aria-hidden className="size-4" />}
        onClick={addRoute}
      >
        Add route
      </Button>

      {!validation.ok ? (
        <p className="text-sm text-destructive" role="alert">
          {validation.error}
        </p>
      ) : null}
    </div>
  )
}