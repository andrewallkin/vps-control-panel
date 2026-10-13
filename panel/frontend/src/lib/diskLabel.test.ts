import { describe, expect, it } from 'vitest'
import { diskMountLabel } from './diskLabel'

describe('diskMountLabel', () => {
  it('labels root as Root filesystem', () => {
    expect(diskMountLabel('/')).toBe('Root filesystem')
  })

  it('labels other paths as Mount plus path', () => {
    expect(diskMountLabel('/boot')).toBe('Mount /boot')
  })
})
