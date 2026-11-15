import { MagnifyingGlass } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog, DialogContent } from './ui/Dialog'
import { Input } from './ui/Input'
import { cn } from '../lib/cn'
import { fetchProjects, type ProjectSummary } from '../lib/projectsApi'

const PAGE_ITEMS = [
  { id: 'page-dashboard', label: 'Dashboard', to: '/' },
  { id: 'page-projects', label: 'Projects', to: '/projects' },
  { id: 'page-new-project', label: 'New project', to: '/projects/new' },
  { id: 'page-domains', label: 'Domains', to: '/domains' },
  { id: 'page-rules', label: 'Rules', to: '/rules' },
  { id: 'page-firewall', label: 'Firewall', to: '/firewall' },
  { id: 'page-backups', label: 'Backups', to: '/backups' },
  { id: 'page-database', label: 'Database', to: '/database' },
  { id: 'page-audit', label: 'Audit', to: '/audit' },
  { id: 'page-settings', label: 'Settings', to: '/settings' },
] as const

export interface PaletteItem {
  id: string
  label: string
  to: string
  group: 'Pages' | 'Projects'
}

function matchesQuery(label: string, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return true
  }
  const words = normalized.split(/\s+/).filter(Boolean)
  const haystack = label.toLowerCase()
  return words.every((word) => haystack.includes(word))
}

function projectHref(project: ProjectSummary) {
  const status = project.creation_state.status
  if (
    status === 'failed' ||
    status === 'awaiting_deploy_key' ||
    status === 'awaiting_ports' ||
    status === 'running'
  ) {
    return `/projects/new?slug=${encodeURIComponent(project.slug)}`
  }
  return `/projects/${encodeURIComponent(project.slug)}`
}

function projectActionItems(project: ProjectSummary, query: string): PaletteItem[] {
  if (!matchesQuery(project.display_name, query) && !matchesQuery(project.slug, query)) {
    return []
  }
  const base = `/projects/${encodeURIComponent(project.slug)}`
  return [
    {
      id: `project-${project.slug}-deploy`,
      label: `Deploy ${project.display_name}`,
      to: `${base}#deploy`,
      group: 'Projects',
    },
    {
      id: `project-${project.slug}-logs`,
      label: `Logs ${project.display_name}`,
      to: `${base}#logs`,
      group: 'Projects',
    },
    {
      id: `project-${project.slug}-environment`,
      label: `Environment ${project.display_name}`,
      to: `${base}#environment`,
      group: 'Projects',
    },
  ]
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

export function isMacPlatform() {
  if (typeof navigator === 'undefined') {
    return false
  }
  const platform = navigator.platform || navigator.userAgent
  return /mac/i.test(platform)
}

export function useCommandPaletteHotkeys(onOpen: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpen()
        return
      }
      if (event.key === '/' && !isEditableTarget(event.target)) {
        event.preventDefault()
        onOpen()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onOpen])
}

export function CommandPaletteSearchButton({
  onClick,
  className,
}: {
  onClick: () => void
  className?: string
}) {
  const shortcut = isMacPlatform() ? '⌘K' : 'Ctrl K'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Search"
      className={cn(
        'flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground cursor-pointer sm:px-3 sm:py-2',
        className,
      )}
    >
      <MagnifyingGlass weight="regular" aria-hidden className="size-5 shrink-0 sm:size-4" />
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden rounded border border-border bg-card px-1.5 py-0.5 font-mono text-sm text-muted-foreground shadow-sm sm:inline">
        {shortcut}
      </kbd>
    </button>
  )
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const listboxId = useId()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    enabled: open,
    refetchIntervalInBackground: false,
  })

  const items = useMemo(() => {
    const pages = PAGE_ITEMS.filter((item) => matchesQuery(item.label, query)).map((item) => ({
      ...item,
      group: 'Pages' as const,
    }))

    const projects = projectsQuery.data ?? []
    const projectRows: PaletteItem[] = []
    for (const project of projects) {
      const mainLabel = project.display_name
      if (matchesQuery(mainLabel, query) || matchesQuery(project.slug, query)) {
        projectRows.push({
          id: `project-${project.slug}`,
          label: mainLabel,
          to: projectHref(project),
          group: 'Projects',
        })
        projectRows.push(...projectActionItems(project, query))
      }
    }

    return [...pages, ...projectRows]
  }, [projectsQuery.data, query])

  useEffect(() => {
    if (!open) {
      return undefined
    }
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(id)
  }, [open])

  const selectedIndex = items.length === 0 ? 0 : Math.min(activeIndex, items.length - 1)

  const goTo = useCallback(
    (item: PaletteItem) => {
      onOpenChange(false)
      navigate(item.to)
    },
    [navigate, onOpenChange],
  )

  const groups = useMemo(() => {
    const result: { name: PaletteItem['group']; items: PaletteItem[] }[] = []
    const pages = items.filter((item) => item.group === 'Pages')
    const projectItems = items.filter((item) => item.group === 'Projects')
    if (pages.length) {
      result.push({ name: 'Pages', items: pages })
    }
    if (projectItems.length) {
      result.push({ name: 'Projects', items: projectItems })
    }
    return result
  }, [items])

  let optionOffset = 0

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setQuery('')
      setActiveIndex(0)
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showClose={false}
        className="top-[12%] max-w-lg translate-y-0 gap-0 p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <div className="border-b border-border p-3">
          <Input
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={items[selectedIndex] ? items[selectedIndex].id : undefined}
            aria-autocomplete="list"
            placeholder="Search pages and projects…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => (items.length ? (index + 1) % items.length : 0))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) =>
                  items.length ? (index - 1 + items.length) % items.length : 0,
                )
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                const item = items[selectedIndex]
                if (item) {
                  goTo(item)
                }
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                handleOpenChange(false)
              }
            }}
          />
        </div>

        <div
          id={listboxId}
          role="listbox"
          aria-label="Search results"
          className="max-h-72 overflow-y-auto p-2"
        >
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No results</p>
          ) : (
            groups.map((group) => (
              <div key={group.name} className="pb-2">
                <p className="px-2 py-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.name}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const index = optionOffset
                    optionOffset += 1
                    const active = index === selectedIndex
                    return (
                      <li key={item.id}>
                        <button
                          id={item.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={cn(
                            'flex w-full rounded-lg px-2 py-2 text-left text-sm transition-colors duration-150 cursor-pointer',
                            active
                              ? 'bg-muted text-foreground'
                              : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                          )}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => goTo(item)}
                        >
                          {item.label}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <div className="flex flex-wrap gap-3 border-t border-border px-3 py-2 text-sm text-muted-foreground">
          <span>
            <kbd className="font-mono">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> open
          </span>
          <span>
            <kbd className="font-mono">esc</kbd> close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
