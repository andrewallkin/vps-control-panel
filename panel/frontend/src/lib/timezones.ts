const intlWithTimeZones = Intl as typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[]
}

export function listTimeZones(): string[] {
  if (typeof intlWithTimeZones.supportedValuesOf === 'function') {
    return [...intlWithTimeZones.supportedValuesOf('timeZone')].sort()
  }
  return ['UTC']
}

export function filterTimeZones(query: string, zones: string[]): string[] {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return zones.slice(0, 80)
  }
  return zones.filter((zone) => zone.toLowerCase().includes(needle)).slice(0, 80)
}
