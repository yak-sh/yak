// Browse's controlled Stack lives in the page graph. Its door's history
// retains snapshots; only the top pane is an address that can be shared.
import { signal } from '@preact/signals'
import type { Bundle } from '@yaks/graph'
import {
  type HistoryEntry,
  type HistoryPort,
  historyPort,
} from '@yaks/ui/history'
import { panesOf, stackAt, stacked } from '@yaks/ux'
import { type Client, client } from '@yaks/client'
import { docs } from '@yaks/ux/vocab'
import { loadVocab } from '@yaks/vocab'
import { localPath, pagePath } from './hosting.ts'

export let frameAt = stackAt('browse')
export let framePath = (entry: HistoryEntry): string => {
  let url = new URL(entry.path, 'http://x')
  return localPath(url.pathname) + url.search + url.hash
}
let initial = (path: string): Bundle => ({
  entity: { eid: frameAt },
  Stack: { panes: [path] },
})

/** Restore only a snapshot whose top matches the address. A copied address,
 * or state from another app, opens one page, not somebody else's stack. */
export let restoredFrames = (entry: HistoryEntry): Bundle => {
  let path = framePath(entry)
  let saved = (entry.state as { browse?: Bundle } | null)?.browse
  let panes = panesOf(saved)
  return saved?.entity?.eid == frameAt && panes.length &&
      panes.at(-1) == path &&
      panes.every((p) => /^\/[^/]*$/.test(p.split('?')[0]))
    ? saved
    : initial(path)
}

/** Bind a page graph to a door. The same bundle drives UX Stack and history. */
export let frameHistory = (
  graph: Pick<Client, 'ent' | 'mutate' | 'watch'>,
  port?: HistoryPort,
) => {
  let entry = port?.read() ?? { path: '/', state: null }
  let write = (e: Bundle) => graph.mutate([e])
  write(restoredFrames(entry))
  let held = graph.watch(`.entity.eid=${frameAt} .Stack`)
  let frames = signal(held.value[0] ?? initial(framePath(entry)))
  let stop = held.subscribe((rows) => {
    if (rows[0]) frames.value = rows[0]
  })
  let path = signal(panesOf(frames.value).at(-1)!)
  let publish = (e: Bundle, replace = false, fromHistory = false) => {
    let next = panesOf(e).at(-1)
    if (!next) return
    if (!fromHistory) {
      let state = port?.read().state
      port?.write({
        path: pagePath(next),
        state: {
          ...(state && typeof state == 'object' ? state : {}),
          browse: e,
        },
      }, replace)
    }
    write(e)
    path.value = next
  }
  // Seed this entry so reload has the same bottom page and scroll offsets.
  publish(frames.value, true)
  let unlisten = port?.listen((entry) =>
    publish(restoredFrames(entry), false, true)
  )
  return {
    frames,
    path,
    change: (
      e: Bundle,
      replace = panesOf(e).join('\0') == panesOf(frames.peek()).join('\0'),
    ) => publish(e, replace),
    go: (to: string, replace = false) => {
      let current = frames.peek()
      if (replace) {
        let panes = panesOf(current)
        publish({
          entity: current.entity,
          Stack: {
            ...(current.Stack as object),
            panes: [...panes.slice(0, -1), to],
          },
        }, true)
      } else if (path.peek() != to) publish(stacked(current, to))
    },
    close: () => {
      unlisten?.()
      stop()
      held.close()
    },
  }
}
let graph = client(loadVocab(docs), [], { vault: false, wireVault: false })
let history = frameHistory(graph, historyPort())
export let frames = signal(history.frames.peek())
export let route = signal(history.path.peek())
let sync = () => {
  let offFrames = history.frames.subscribe((value) => {
    frames.value = value
  })
  let offRoute = history.path.subscribe((value) => {
    route.value = value
  })
  return () => {
    offFrames()
    offRoute()
  }
}
let unsync = sync()
/** Bind another door before painting, or a private port in a host test. */
export let bindHistory = (port?: HistoryPort, page: Client = graph): void => {
  unsync()
  history.close()
  history = frameHistory(page, port)
  unsync = sync()
}
export let changeFrames = (e: Bundle, replace?: boolean) =>
  history.change(e, replace)
export let go = (to: string, replace?: boolean) => history.go(to, replace)
