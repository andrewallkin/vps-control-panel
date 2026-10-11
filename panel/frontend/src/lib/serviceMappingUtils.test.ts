import { describe, expect, it } from 'vitest'
import {
  isServiceRowEmpty,
  prepareServiceMappingRows,
  tagPrefixFromImageEnvVar,
  type ServiceMappingRow,
} from './serviceMappingUtils'

describe('serviceMappingUtils', () => {
  it('derives tag prefix from DOCKER_IMAGE env var', () => {
    expect(tagPrefixFromImageEnvVar('DOCKER_IMAGE_BACKEND')).toBe('backend')
    expect(tagPrefixFromImageEnvVar('DOCKER_IMAGE_WEB_APP')).toBe('web-app')
  })

  it('drops fully empty rows', () => {
    const rows: ServiceMappingRow[] = [
      { service_name: '', image_env_var: '', tag_prefix: '' },
      {
        service_name: 'web',
        image_env_var: 'DOCKER_IMAGE_WEB',
        tag_prefix: 'web',
      },
    ]
    const result = prepareServiceMappingRows(rows)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows).toHaveLength(1)
    }
    expect(isServiceRowEmpty(rows[0]!)).toBe(true)
  })

  it('rejects partial rows', () => {
    const result = prepareServiceMappingRows([
      { service_name: 'web', image_env_var: '', tag_prefix: '' },
    ])
    expect(result.ok).toBe(false)
  })

  it('rejects invalid env var or tag prefix', () => {
    expect(
      prepareServiceMappingRows([
        {
          service_name: 'web',
          image_env_var: 'NOT_DOCKER',
          tag_prefix: 'web',
        },
      ]).ok,
    ).toBe(false)
    expect(
      prepareServiceMappingRows([
        {
          service_name: 'web',
          image_env_var: 'DOCKER_IMAGE_WEB',
          tag_prefix: 'bad prefix',
        },
      ]).ok,
    ).toBe(false)
  })
})
