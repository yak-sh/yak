import { useSyncExternalStore } from 'react'

/** Read a synchronous snapshot on the server and subscribe to it on mount. */
export let useStore = <T>(
  subscribe: (changed: () => void) => () => void,
  read: () => T,
): T => {
  let useSnapshot: (
    subscribe: (changed: () => void) => () => void,
    read: () => T,
    server: () => T,
  ) => T = useSyncExternalStore
  return useSnapshot(subscribe, read, read)
}
