import type { ContainerMetrics } from './dashboardTypes'

export type ContainerSortKey = 'cpu_percent' | 'mem_percent'
export type SortDirection = 'asc' | 'desc'

export interface GroupedContainers {
  project: string
  containers: ContainerMetrics[]
}

export function groupContainersByProject(
  containers: ContainerMetrics[],
): GroupedContainers[] {
  const map = new Map<string, ContainerMetrics[]>()
  for (const container of containers) {
    const key = container.project ?? 'Other'
    const list = map.get(key) ?? []
    list.push(container)
    map.set(key, list)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([project, group]) => ({ project, containers: group }))
}

export function sortContainers(
  containers: ContainerMetrics[],
  key: ContainerSortKey,
  direction: SortDirection,
): ContainerMetrics[] {
  const factor = direction === 'asc' ? 1 : -1
  return [...containers].sort((a, b) => {
    const diff = a[key] - b[key]
    if (diff === 0) {
      return a.name.localeCompare(b.name) * factor
    }
    return diff * factor
  })
}

export function sortGroupedContainers(
  groups: GroupedContainers[],
  key: ContainerSortKey,
  direction: SortDirection,
): GroupedContainers[] {
  return groups.map((group) => ({
    ...group,
    containers: sortContainers(group.containers, key, direction),
  }))
}
