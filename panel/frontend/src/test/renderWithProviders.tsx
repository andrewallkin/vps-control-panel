import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions } from '@testing-library/react'
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom'
import { ToastProvider } from '../components/ui'

export function renderWithProviders(
  ui: ReactElement,
  options?: {
    routerProps?: MemoryRouterProps
    queryClient?: QueryClient
  } & Omit<RenderOptions, 'wrapper'>,
) {
  const queryClient =
    options?.queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchIntervalInBackground: false },
      },
    })

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter {...options?.routerProps}>{children}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    )
  }

  return render(ui, { wrapper: Wrapper, ...options })
}
