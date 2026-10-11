import { describe, expect, it } from 'vitest'
import {
  groupContainersByProject,
  sortContainers,
  sortGroupedContainers,
} from './containersSort'
import type { ContainerMetrics } from './dashboardTypes'

const sample: ContainerMetrics[] = [
  {
    name: 'b',
    project: 'alpha',
    cpu_percent: 2,
    mem_used: 100,
    mem_limit: 1000,
    mem_percent: 10,
  },
  {
    name: 'a',
    project: null,
    cpu_percent: 5,
    mem_used: 200,
    mem_limit: 1000,
    mem_percent: 20,
  },
  {
    name: 'c',
    project: 'alpha',
    cpu_percent: 1,
    mem_used: 50,
    mem_limit: 1000,
    mem_percent: 5,
  },
]

describe('groupContainersByProject', () => {
  it('groups null project as Other', () => {
    const groups = groupContainersByProject(sample)
    expect(groups.map((g) => g.project)).toEqual(['alpha', 'Other'])
    expect(groups.find((g) => g.project === 'Other')?.containers).toHaveLength(1)
  })
})

describe('sortContainers', () => {
  it('sorts by cpu descending', () => {
    const sorted = sortContainers(sample, 'cpu_percent', 'desc')
    expect(sorted.map((c) => c.name)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by memory ascending', () => {
    const sorted = sortContainers(sample, 'mem_percent', 'asc')
    expect(sorted.map((c) => c.name)).toEqual(['c', 'b', 'a'])
  })
})

describe('sortGroupedContainers', () => {
  it('sorts within each group', () => {
    const groups = groupContainersByProject(sample)
    const sorted = sortGroupedContainers(groups, 'cpu_percent', 'desc')
    const alpha = sorted.find((g) => g.project === 'alpha')
    expect(alpha?.containers.map((c) => c.name)).toEqual(['b', 'c'])
  })
})
