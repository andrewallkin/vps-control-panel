import { describe, expect, it } from 'vitest'
import { isHealthCheckLog } from './healthCheckLog'

describe('isHealthCheckLog', () => {
  it('matches health access logs from any project path', () => {
    expect(
      isHealthCheckLog(
        'backend-1 | 2026-10-14T18:10:37.095884931Z INFO: 127.0.0.1:36298 - "GET /api/health HTTP/1.1" 200 OK',
      ),
    ).toBe(true)
    expect(isHealthCheckLog('web-1 | "GET /health HTTP/1.1" 200')).toBe(true)
    expect(isHealthCheckLog('api-1 | "HEAD /api/v1/healthz HTTP/1.1" 200')).toBe(true)
    expect(isHealthCheckLog('GET /ready/health?full=1 HTTP/1.1')).toBe(true)
  })

  it('leaves ordinary request logs visible', () => {
    expect(isHealthCheckLog('backend-1 | "GET /api/users HTTP/1.1" 200 OK')).toBe(false)
    expect(isHealthCheckLog('backend-1 | "GET /healthcare HTTP/1.1" 200 OK')).toBe(false)
    expect(isHealthCheckLog('backend-1 | application started')).toBe(false)
  })
})
