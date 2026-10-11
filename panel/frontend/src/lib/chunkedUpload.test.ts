import { describe, expect, it, vi } from 'vitest'
import { CHUNK_SIZE, listChunkSlices, uploadDumpFile } from './chunkedUpload'

describe('listChunkSlices', () => {
  it('splits file size into 8 MiB chunks', () => {
    expect(listChunkSlices(0)).toEqual([])
    expect(listChunkSlices(1024)).toEqual([{ offset: 0, length: 1024 }])
    expect(listChunkSlices(CHUNK_SIZE)).toEqual([
      { offset: 0, length: CHUNK_SIZE },
    ])
    expect(listChunkSlices(CHUNK_SIZE + 1)).toEqual([
      { offset: 0, length: CHUNK_SIZE },
      { offset: CHUNK_SIZE, length: 1 },
    ])
  })
})

describe('uploadDumpFile resume', () => {
  it('uses server offset on retry after a failed chunk PUT', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'dump.sql', {
      type: 'application/octet-stream',
    })
    const putOffsets: number[] = []
    let putAttempts = 0

    const putChunk = vi.fn(
      async (_uploadId: string, offset: number, body: Blob) => {
        putOffsets.push(offset)
        putAttempts += 1
        if (putAttempts === 1) {
          throw new Error('network')
        }
        return { received: offset + (await body.arrayBuffer()).byteLength }
      },
    )

    const fetchReceived = vi.fn(async () => ({ received: 2 }))

    await uploadDumpFile(file, {
      deps: {
        createUpload: vi.fn(async () => ({ upload_id: 'up-test' })),
        putChunk,
        fetchReceived,
        completeUpload: vi.fn(async () => ({
          id: 'up-test',
          filename: 'dump.sql',
          size: 4,
          kind: 'plain',
          header_ok: true,
          databases: [],
          roles: [],
        })),
        deleteUpload: vi.fn(async () => undefined),
      },
    })

    expect(fetchReceived).toHaveBeenCalledWith('up-test')
    expect(putOffsets).toEqual([0, 2])
  })
})
