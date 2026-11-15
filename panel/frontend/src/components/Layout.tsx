import {
  CloudArrowUp,
  Database,
  Gauge,
  Funnel,
  Globe,
  Gear,
  List,
  MagnifyingGlass,
  Scroll,
  Shield,
  Stack,
  X,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { cn } from '../lib/cn'
import {
  CommandPalette,
  CommandPaletteSearchButton,
  useCommandPaletteHotkeys,
} from './CommandPalette'
import { IconButton, ProductLogo } from './ui'

export function Layout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const drawerTitleId = useId()
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const drawerPanelRef = useRef<HTMLDivElement>(null)
  const openPalette = useCallback(() => setPaletteOpen(true), [])

  useCommandPaletteHotkeys(openPalette)

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

  useEffect(() => {
    if (!drawerOpen) {
      return
    }
    const id = window.requestAnimationFrame(() => {
      const panel = drawerPanelRef.current
      if (!panel) {
        return
      }
      const focusable = panel.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      focusable?.focus()
    })
    return () => window.cancelAnimationFrame(id)
  }, [drawerOpen])

  const closeDrawer = () => {
    setDrawerOpen(false)
    window.requestAnimationFrame(() => {
      menuButtonRef.current?.focus()
    })
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors duration-150 cursor-pointer',
      isActive
        ? 'bg-muted text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent'
        : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
    )

  const mainNav = (
    <>
      <NavLink to="/" end className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <Gauge weight="regular" aria-hidden className="size-4 shrink-0" />
        Dashboard
      </NavLink>
      <NavLink to="/projects" className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <Stack weight="regular" aria-hidden className="size-4 shrink-0" />
        Projects
      </NavLink>
      <NavLink to="/domains" className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <Globe weight="regular" aria-hidden className="size-4 shrink-0" />
        Domains
      </NavLink>
      <NavLink to="/rules" className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <Funnel weight="regular" aria-hidden className="size-4 shrink-0" />
        Rules
      </NavLink>
      <NavLink to="/firewall" className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <Shield weight="regular" aria-hidden className="size-4 shrink-0" />
        Firewall
      </NavLink>
      <NavLink to="/backups" className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <CloudArrowUp weight="regular" aria-hidden className="size-4 shrink-0" />
        Backups
      </NavLink>
      <NavLink to="/database" className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <Database weight="regular" aria-hidden className="size-4 shrink-0" />
        Database
      </NavLink>
      <NavLink to="/audit" className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <Scroll weight="regular" aria-hidden className="size-4 shrink-0" />
        Audit
      </NavLink>
      <NavLink to="/settings" className={navLinkClass} onClick={() => setDrawerOpen(false)}>
        <Gear weight="regular" aria-hidden className="size-4 shrink-0" />
        Settings
      </NavLink>
    </>
  )

  return (
    <div className="fixed inset-0 flex overflow-hidden overscroll-none bg-background text-foreground">
      <a
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-popover"
      >
        Skip to content
      </a>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <div className="flex min-h-0 w-full flex-1">
        <aside className="hidden min-h-0 w-56 shrink-0 flex-col overflow-y-auto border-r border-border bg-card lg:flex">
          <div className="space-y-3 border-b border-border px-4 py-4">
            <Link to="/" className="cursor-pointer">
              <ProductLogo size="sm" showName nameClassName="tracking-tight" />
            </Link>
            <CommandPaletteSearchButton onClick={openPalette} />
          </div>
          <nav className="flex flex-col gap-0.5 p-2" aria-label="Main">
            {mainNav}
          </nav>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 lg:hidden">
            <button
              ref={menuButtonRef}
              type="button"
              className="rounded-lg p-2 text-foreground transition-colors duration-150 hover:bg-muted cursor-pointer"
              aria-expanded={drawerOpen}
              aria-controls="mobile-nav-drawer"
              onClick={() => setDrawerOpen(true)}
            >
              <span className="sr-only">Open navigation menu</span>
              <List weight="regular" aria-hidden className="size-5" />
            </button>
            <ProductLogo size="sm" showName />
            <IconButton label="Search" size="sm" className="ml-auto" onClick={openPalette}>
              <MagnifyingGlass weight="regular" aria-hidden className="size-5" />
            </IconButton>
          </header>

          {drawerOpen ? (
            <div className="fixed inset-0 z-40 lg:hidden">
              <button
                type="button"
                className="absolute inset-0 bg-background/80 cursor-pointer"
                aria-label="Dismiss navigation menu"
                onClick={closeDrawer}
              />
              <div
                ref={drawerPanelRef}
                id="mobile-nav-drawer"
                role="dialog"
                aria-modal="true"
                aria-labelledby={drawerTitleId}
                className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-card shadow-popover"
              >
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <p id={drawerTitleId} className="text-sm font-semibold">
                    Menu
                  </p>
                  <button
                    type="button"
                    className="rounded-lg p-2 transition-colors duration-150 hover:bg-muted cursor-pointer"
                    onClick={closeDrawer}
                  >
                    <span className="sr-only">Close navigation menu</span>
                    <X weight="regular" aria-hidden className="size-5" />
                  </button>
                </div>
                <nav className="flex flex-col gap-0.5 p-2" aria-label="Main">
                  {mainNav}
                </nav>
              </div>
            </div>
          ) : null}

          <main
            id="main-content"
            tabIndex={-1}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6 lg:p-8"
          >
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
