import {
  CloudArrowUp,
  Database,
  Gauge,
  Globe,
  Gear,
  List,
  Scroll,
  Shield,
  Stack,
  X,
} from '@phosphor-icons/react'
import { useEffect, useId, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'

export function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const drawerTitleId = useId()

  useEffect(() => {
    if (!drawerOpen) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    [
      'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-200 cursor-pointer',
      isActive
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    ].join(' ')

  const mainNav = (
    <>
      <NavLink to="/" end className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <Gauge weight="regular" aria-hidden className="size-5 shrink-0" />
        Dashboard
      </NavLink>
      <NavLink to="/projects" className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <Stack weight="regular" aria-hidden className="size-5 shrink-0" />
        Projects
      </NavLink>
      <NavLink to="/domains" className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <Globe weight="regular" aria-hidden className="size-5 shrink-0" />
        Domains
      </NavLink>
      <NavLink to="/firewall" className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <Shield weight="regular" aria-hidden className="size-5 shrink-0" />
        Firewall
      </NavLink>
      <NavLink to="/backups" className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <CloudArrowUp weight="regular" aria-hidden className="size-5 shrink-0" />
        Backups
      </NavLink>
      <NavLink to="/database" className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <Database weight="regular" aria-hidden className="size-5 shrink-0" />
        Database
      </NavLink>
      <NavLink to="/audit" className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <Scroll weight="regular" aria-hidden className="size-5 shrink-0" />
        Audit
      </NavLink>
      <NavLink to="/settings" className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <Gear weight="regular" aria-hidden className="size-5 shrink-0" />
        Settings
      </NavLink>
    </>
  )

  return (
    <div className="h-dvh overflow-hidden bg-background text-foreground">
      <div className="flex h-full min-h-0">
        <aside className="hidden h-full w-56 shrink-0 flex-col overflow-y-auto border-r border-border bg-card lg:flex">
          <div className="border-b border-border px-4 py-4">
            <Link to="/" className="text-sm font-semibold tracking-tight cursor-pointer">
              VPS Control Panel
            </Link>
          </div>
          <nav className="flex flex-col gap-1 p-3" aria-label="Main">
            {mainNav}
          </nav>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 lg:hidden">
            <button
              type="button"
              className="rounded-md p-2 text-foreground transition-colors duration-200 hover:bg-muted cursor-pointer"
              aria-expanded={drawerOpen}
              aria-controls="mobile-nav-drawer"
              onClick={() => setDrawerOpen(true)}
            >
              <span className="sr-only">Open navigation menu</span>
              <List weight="regular" aria-hidden className="size-6" />
            </button>
            <span className="text-sm font-semibold">VPS Control Panel</span>
          </header>

          {drawerOpen ? (
            <div className="fixed inset-0 z-40 lg:hidden">
              <button
                type="button"
                className="absolute inset-0 bg-background/80 cursor-pointer"
                aria-label="Dismiss navigation menu"
                onClick={() => setDrawerOpen(false)}
              />
              <div
                id="mobile-nav-drawer"
                role="dialog"
                aria-modal="true"
                aria-labelledby={drawerTitleId}
                className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-card shadow-lg"
              >
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <p id={drawerTitleId} className="text-sm font-semibold">
                    Menu
                  </p>
                  <button
                    type="button"
                    className="rounded-md p-2 transition-colors duration-200 hover:bg-muted cursor-pointer"
                    onClick={() => setDrawerOpen(false)}
                  >
                    <span className="sr-only">Close navigation menu</span>
                    <X weight="regular" aria-hidden className="size-5" />
                  </button>
                </div>
                <nav className="flex flex-col gap-1 p-3" aria-label="Main">
                  {mainNav}
                </nav>
              </div>
            </div>
          ) : null}

          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
