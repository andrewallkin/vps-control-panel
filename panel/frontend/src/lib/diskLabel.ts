/** Human-readable label for a filesystem mount path in dashboard disk lists. */
export function diskMountLabel(path: string): string {
  if (path === '/') return 'Root filesystem'
  return `Mount ${path}`
}
