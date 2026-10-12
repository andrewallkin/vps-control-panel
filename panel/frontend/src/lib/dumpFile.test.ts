import { describe, expect, it } from 'vitest'
import { ACCEPT, isAcceptedDump } from './dumpFile'

function fakeFile(name: string): File {
  return new File(['x'], name, { type: 'application/octet-stream' })
}

describe('isAcceptedDump', () => {
  it('accepts plaintext and age-encrypted dumps', () => {
    // Backups upload as backup_*.sql.gz.age; the disaster-recovery path is
    // download-from-GCS → restore in panel. The picker must accept them.
    expect(isAcceptedDump(fakeFile('cutover.sql.gz'))).toBe(true)
    expect(isAcceptedDump(fakeFile('cutover.sql'))).toBe(true)
    expect(isAcceptedDump(fakeFile('backup_2026-01-01.sql.gz.age'))).toBe(true)
    expect(isAcceptedDump(fakeFile('backup_2026-01-01.sql.age'))).toBe(true)
  })

  it('rejects other files', () => {
    expect(isAcceptedDump(fakeFile('backup.tar'))).toBe(false)
    expect(isAcceptedDump(fakeFile('notes.txt'))).toBe(false)
  })

  it('ACCEPT includes the age suffixes', () => {
    expect(ACCEPT).toContain('.sql.gz.age')
    expect(ACCEPT).toContain('.sql.age')
  })
})
