// App storage's two host effects: a committed write reports its measured
// size, and erasure clears the storage before planting a fresh graph.
import { Refused } from '@yaks/graph/errors'
import { PLATFORM_STORE } from '@yaks/platform/names'

/** One report in flight; sub-MiB movement waits for a later committed write. */
export let weighing = (host: {
  read: () => { bytes: number; told: string | null } | null
  tell: (bytes: number) => Promise<unknown>
  remember: (bytes: number) => void
  failed: (error: unknown) => void
  wait: (work: Promise<void>) => void
}) => {
  let pending: Promise<void> | null = null
  let report = async () => {
    try {
      let held = host.read()
      if (!held) return
      let { bytes, told } = held
      if (told != null && Math.abs(bytes - Number(told)) < 1024 ** 2) return
      await host.tell(bytes)
      host.remember(bytes)
    } catch (error) {
      host.failed(error)
    }
  }
  return () => {
    if (pending) return
    pending = report().finally(() => pending = null)
    host.wait(pending)
  }
}

type Page = { close?(code: number, reason: string): void }

/** Close the old graph's pages, clear the whole storage, then plant again. */
export let eraseStore = async <T extends Page>(name: string, host: {
  pages: Iterable<T>
  close: (page: T) => void
  clear: () => Promise<void>
  plant: (name: string) => Response
}) => {
  if (name == PLATFORM_STORE) {
    throw new Refused('The directory cannot be erased')
  }
  for (let page of host.pages) {
    host.close(page)
    try {
      page.close?.(1000, 'deleted')
    } catch { /* already gone */ }
  }
  await host.clear()
  return host.plant(name)
}
