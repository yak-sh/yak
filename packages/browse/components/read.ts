import { useMemo } from 'react'
import { computed } from '@preact/signals-core'
import { useObserved } from '@yaks/ux'

/** Read a derived snapshot and draw again when one of its inputs changes. */
export let useDerived = <T>(read: () => T, dependencies: unknown[]): T =>
  useObserved(useMemo(() => computed(read), dependencies))
