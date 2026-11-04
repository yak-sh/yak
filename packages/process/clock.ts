// A host clock whose pending callbacks do not keep a command alive.
import { clearTimeout, setTimeout } from 'node:timers'

export let clock = {
  now: Date.now,
  after: (ms: number, run: () => void): () => void => {
    let timer = setTimeout(run, ms)
    timer.unref()
    return () => clearTimeout(timer)
  },
}
