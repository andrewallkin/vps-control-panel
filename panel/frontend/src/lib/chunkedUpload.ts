import { createSHA256 } from 'hash-wasm'
import {
  completeSetupUpload,
  createSetupUpload,
  deleteSetupUpload,
  fetchSetupUploadReceived,
  putSetupUploadChunk,
  type UploadCompleteInfo,
} from './setupApi'

export const CHUNK_SIZE = 8 * 1024 * 1024
const MAX_CHUNK_RETRIES = 3

export interface ChunkSlice {
  offset: number
  length: number
}

export function listChunkSlices(fileSize: number): ChunkSlice[] {
  if (fileSize <= 0) {
    return []
  }
  const slices: ChunkSlice[] = []
  for (let offset = 0; offset < fileSize; offset += CHUNK_SIZE) {
    slices.push({
      offset,
      length: Math.min(CHUNK_SIZE, fileSize - offset),
    })
  }
  return slices
}

export interface UploadProgress {
  sent: number
  total: number
  bytesPerSec: number
  etaSec: number | null
}

export interface ChunkedUploadDeps {
  createUpload: typeof createSetupUpload
  putChunk: typeof putSetupUploadChunk
  fetchReceived: typeof fetchSetupUploadReceived
  completeUpload: typeof completeSetupUpload
  deleteUpload: typeof deleteSetupUpload
}

const defaultDeps: ChunkedUploadDeps = {
  createUpload: createSetupUpload,
  putChunk: putSetupUploadChunk,
  fetchReceived: fetchSetupUploadReceived,
  completeUpload: completeSetupUpload,
  deleteUpload: deleteSetupUpload,
}

async function refreshServerOffset(
  uploadId: string,
  fetchReceived: ChunkedUploadDeps['fetchReceived'],
): Promise<number> {
  const meta = await fetchReceived(uploadId)
  return meta.received
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Upload aborted', 'AbortError')
  }
}

async function putChunkWithRetries(
  uploadId: string,
  file: File,
  chunkEnd: number,
  putChunk: ChunkedUploadDeps['putChunk'],
  fetchReceived: ChunkedUploadDeps['fetchReceived'],
  initialOffset: number,
  signal?: AbortSignal,
): Promise<number> {
  let serverOffset = initialOffset
  for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt += 1) {
    throwIfAborted(signal)
    try {
      const blob = file.slice(serverOffset, chunkEnd)
      const result = await putChunk(uploadId, serverOffset, blob, { signal })
      return result.received
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw error
        }
        throw new DOMException('Upload aborted', 'AbortError')
      }
      serverOffset = await refreshServerOffset(uploadId, fetchReceived)
      if (attempt === MAX_CHUNK_RETRIES - 1) {
        throw new Error('chunk upload failed', { cause: error })
      }
    }
  }
  throw new Error('chunk upload failed')
}

export async function uploadDumpFile(
  file: File,
  options: {
    onProgress?: (progress: UploadProgress) => void
    signal?: AbortSignal
    deps?: Partial<ChunkedUploadDeps>
  } = {},
): Promise<{ uploadId: string; info: UploadCompleteInfo }> {
  const deps = { ...defaultDeps, ...options.deps }
  const { upload_id: uploadId } = await deps.createUpload(file.name, file.size)
  const hasher = await createSHA256()
  let serverOffset = 0
  let lastHashedOffset = -1
  const startedAt = performance.now()

  try {
    while (serverOffset < file.size) {
      throwIfAborted(options.signal)

      const chunkStart = serverOffset
      const chunkEnd = Math.min(serverOffset + CHUNK_SIZE, file.size)
      if (chunkStart !== lastHashedOffset) {
        const chunkBytes = new Uint8Array(
          await file.slice(chunkStart, chunkEnd).arrayBuffer(),
        )
        hasher.update(chunkBytes)
        lastHashedOffset = chunkStart
      }

      serverOffset = await putChunkWithRetries(
        uploadId,
        file,
        chunkEnd,
        deps.putChunk,
        deps.fetchReceived,
        chunkStart,
        options.signal,
      )

      throwIfAborted(options.signal)

      const elapsedSec = Math.max((performance.now() - startedAt) / 1000, 0.001)
      const bytesPerSec = serverOffset / elapsedSec
      const remaining = file.size - serverOffset
      const etaSec = bytesPerSec > 0 ? remaining / bytesPerSec : null
      options.onProgress?.({
        sent: serverOffset,
        total: file.size,
        bytesPerSec,
        etaSec,
      })
    }

    throwIfAborted(options.signal)

    const sha256 = hasher.digest('hex')
    const info = await deps.completeUpload(uploadId, sha256)
    return { uploadId, info }
  } catch (error) {
    await deps.deleteUpload(uploadId).catch(() => undefined)
    throw error
  }
}
