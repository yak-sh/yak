// Where Browse is comes from its door's history: one page at a time, each at
// its own address. Going somewhere adds an entry, and the door's back and
// forward (the browser's, or Ctrl-O and Ctrl-F in a terminal) are the way
// back. An entry keeps how far its page was scrolled when it was left, so the
// way back finds the place too.
import { signal } from '@preact/signals'
import {
  type HistoryEntry,
  type HistoryPort,
  historyPort,
} from '@yaks/ui/history'
import { localPath, pagePath } from './hosting.ts'

/** The page: a local path, its search and its hash. */
export let route = signal('/')
/** How far the page was scrolled when it was last left, to start at. */
export let left = signal(0)

let port: HistoryPort | undefined
let unlisten = () => {}
let offset = 0

let pathOf = (entry: HistoryEntry) => {
  let url = new URL(entry.path, 'http://x')
  return localPath(url.pathname) + url.search + url.hash
}
let arrive = (entry: HistoryEntry) => {
  offset = Number((entry.state as { scroll?: number } | null)?.scroll) || 0
  left.value = offset
  route.value = pathOf(entry)
}

/** Read and write a door's history: the one it installed, or a test's. */
export let bindHistory = (history = historyPort()): void => {
  unlisten()
  port = history
  arrive(port?.read() ?? { path: '/', state: null })
  unlisten = port?.listen(arrive) ?? (() => {})
}

/** The page says how far it is scrolled; the entry keeps it on leaving. */
export let scrolledTo = (top: number): void => {
  offset = top
}

/** Go to `to` in a new entry, or in place of this one. */
export let go = (to: string, replace = false): void => {
  let from = route.peek()
  if (to == from && !replace) return
  if (!replace) {
    port?.write({ path: pagePath(from), state: { scroll: offset } }, true)
  }
  port?.write({ path: pagePath(to), state: null }, replace)
  offset = 0
  left.value = 0
  route.value = to
}

bindHistory()
