import { describe, expect, it } from 'vitest'
import type { ExposureRow } from './firewallApi'
import { formatSource, splitExposure } from './firewallUtils'

function row(partial: Partial<ExposureRow> & Pick<ExposureRow, 'address' | 'port'>): ExposureRow {
  return {
    process: '',
    proto: 'tcp',
    external: false,
    expected: false,
    ...partial,
  }
}

describe('formatSource', () => {
  it('names internet-wide allows in plain language', () => {
    expect(formatSource('Anywhere')).toBe('Anyone on the internet')
    expect(formatSource('10.0.0.8')).toBe('10.0.0.8')
  })
})

describe('splitExposure', () => {
  it('groups the same public listener across address families', () => {
    const { publicListeners, localListeners } = splitExposure([
      row({ address: '0.0.0.0', port: 22, process: 'sshd', external: true, expected: true }),
      row({ address: '::', port: 22, process: 'sshd', external: true, expected: true }),
      row({ address: '127.0.0.53%lo', port: 53, process: 'systemd-resolve' }),
      row({ address: '0.0.0.0', port: 8080, process: 'docker-proxy' }),
    ])

    expect(publicListeners).toEqual([
      {
        key: '22-tcp-sshd-true',
        port: 22,
        proto: 'tcp',
        process: 'sshd',
        reach: 'IPv4 and IPv6',
        expected: true,
      },
    ])
    expect(localListeners).toEqual([
      {
        key: '127.0.0.53%lo-53-tcp-systemd-resolve',
        address: '127.0.0.53',
        scopeLabel: 'loopback interface',
        port: 53,
        proto: 'tcp',
        process: 'systemd-resolve',
        blockedByFirewall: false,
      },
      {
        key: '0.0.0.0-8080-tcp-docker-proxy',
        address: '0.0.0.0',
        scopeLabel: null,
        port: 8080,
        proto: 'tcp',
        process: 'docker-proxy',
        blockedByFirewall: true,
      },
    ])
  })
})
