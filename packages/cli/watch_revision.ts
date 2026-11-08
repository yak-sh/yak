// Wake an effect pool from committed revisions read beside its main thread.
// Only one read is outstanding; a slow database cannot queue polling work.
import { type Clock, system } from '@yaks/fp'

export let watchRevision = (
  read: () => unknown | Promise<unknown>,
  changed: () => void,
  report: (error: unknown) => void,
  clock: Clock = system,
): () => void => {
  let stopped = false, first = true, prior: unknown
  let cancel = () => {}
  let look = async () => {
    try {
      let next = await read()
      if (stopped) return
      if (!first && next !== prior) changed()
      first = false
      prior = next
      cancel = clock.after(50, () => void look())
    } catch (error) {
      if (!stopped) report(error)
    }
  }
  void look()
  return () => {
    stopped = true
    cancel()
  }
}
