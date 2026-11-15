import { useEffect } from 'react'

export function useUnsavedChangesWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) {
      return undefined
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])
}
