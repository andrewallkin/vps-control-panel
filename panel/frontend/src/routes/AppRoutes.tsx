import type { ReactNode } from 'react'
import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { isAuthenticated, useAuthMe } from '../hooks/useAuthMe'
import { DashboardPage } from '../pages/DashboardPage'
import { DomainsPage } from '../pages/DomainsPage'
import { LoginPage } from '../pages/LoginPage'
import { SettingsPage } from '../pages/SettingsPage'
import { SetupPage } from '../pages/SetupPage'

function AuthLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  )
}

function RequireAuth() {
  const { data, error, isPending } = useAuthMe()
  const auth = isAuthenticated(data, error, isPending)

  if (auth === null) {
    return <AuthLoading />
  }
  if (!auth) {
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}

function RequireSetupComplete({ children }: { children: ReactNode }) {
  const { data: me, error, isPending } = useAuthMe()
  const auth = isAuthenticated(me, error, isPending)

  if (auth === null) {
    return <AuthLoading />
  }
  if (!auth || !me) {
    return <Navigate to="/login" replace />
  }
  if (!me.setup_complete) {
    return <Navigate to="/setup" replace />
  }
  return children
}

function DashboardEntry() {
  return (
    <RequireSetupComplete>
      <DashboardPage />
    </RequireSetupComplete>
  )
}

function DomainsEntry() {
  return (
    <RequireSetupComplete>
      <DomainsPage />
    </RequireSetupComplete>
  )
}

function SettingsEntry() {
  return (
    <RequireSetupComplete>
      <SettingsPage />
    </RequireSetupComplete>
  )
}

function SetupEntry() {
  const { data: me, error, isPending } = useAuthMe()
  const auth = isAuthenticated(me, error, isPending)

  if (auth === null) {
    return <AuthLoading />
  }
  if (!auth || !me) {
    return <Navigate to="/login" replace />
  }
  if (me.setup_complete) {
    return <Navigate to="/" replace />
  }
  return <SetupPage />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<DashboardEntry />} />
          <Route path="domains" element={<DomainsEntry />} />
          <Route path="settings" element={<SettingsEntry />} />
        </Route>
        <Route path="setup" element={<SetupEntry />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
