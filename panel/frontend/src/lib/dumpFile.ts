export const ACCEPT = '.sql,.sql.gz,.sql.age,.sql.gz.age'

export function isAcceptedDump(file: File): boolean {
  const name = file.name.toLowerCase()
  return (
    name.endsWith('.sql') ||
    name.endsWith('.sql.gz') ||
    name.endsWith('.sql.age') ||
    name.endsWith('.sql.gz.age')
  )
}
