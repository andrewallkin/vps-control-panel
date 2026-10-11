import type { JobEndPayload } from './setupApi'

export interface JobLineEvent {
  n: number
  text: string
}

export function parseSseBlock(block: string): { event: string; data: string } | null {
  const lines = block.split('\n')
  let event = 'message'
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }
  if (dataLines.length === 0) {
    return null
  }
  return { event, data: dataLines.join('\n') }
}

export function parseJobLineData(data: string): JobLineEvent | null {
  try {
    const parsed = JSON.parse(data) as JobLineEvent
    if (typeof parsed.n === 'number' && typeof parsed.text === 'string') {
      return parsed
    }
  } catch {
    return null
  }
  return null
}

export function parseJobEndData(data: string): JobEndPayload | null {
  try {
    return JSON.parse(data) as JobEndPayload
  } catch {
    return null
  }
}
