import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useUnsavedChangesWarning } from './useUnsavedChangesWarning'

describe('useUnsavedChangesWarning', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers beforeunload while dirty', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const { rerender, unmount } = renderHook(
      ({ dirty }) => useUnsavedChangesWarning(dirty),
      { initialProps: { dirty: true } },
    )

    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))

    rerender({ dirty: false })
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))

    unmount()
  })

  it('does not register when clean', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    renderHook(() => useUnsavedChangesWarning(false))
    expect(addSpy).not.toHaveBeenCalled()
  })
})
