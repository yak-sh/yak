// Box telemetry observes the runtime channel, never the watched database.
// Selection happens after a root completes; all unselected trees die in memory.
//
// A tree is held until its root ends, and some roots never do: an effect that
// watches for the life of the process, a socket. Delivery keeps at most
// TRACE_MAX_SPANS of a tree, so a tree past a few times that is cut back to
// the spans worth holding (@yaks/timing `held`). Held whole, such a root kept
// every span it ever ran until the worker ran out of heap.
import type { Bundle } from '@yaks/graph'
import { held, TRACE_MAX_SPANS } from '@yaks/timing/cap'
import {
  type RequestState,
  sampleRequest,
  selectRequest,
} from '@yaks/timing/request'
import { channel, type Event } from '@yaks/trace'
import type { Sink } from '@yaks/tracker/report'

export type Capture = { requested: boolean; rate: number }
export type Traces = { close: () => Promise<void> }

// The most spans one tree holds before it is cut back.
let HOLD = 4 * TRACE_MAX_SPANS

export let traces = (
  graph: object,
  options: {
    process: string
    getStart?: (event: Event) => boolean
    reportGetStart?: (stack: string) => void
    sink?: Sink
    take: () => Promise<Capture>
    origin?: number
    now?: () => number
    random?: () => number
  },
): Traces => {
  let origin = options.origin ?? performance.timeOrigin
  let now = options.now ?? Date.now
  let random = options.random ?? Math.random
  let quota: RequestState = new Map()
  let roots = new Map<string, string>()
  let trees = new Map<string, {
    events: Map<string, Event>
    capture: Promise<Capture | undefined>
  }>()
  let trim = (events: Map<string, Event>) => {
    let keep = held([...events.values()])
    for (let id of events.keys()) {
      if (keep.has(id)) continue
      events.delete(id)
      roots.delete(id)
    }
  }
  let pending = new Set<Promise<void>>()
  // Selection can be waiting on another process's capture-control lock. It
  // has delivered nothing yet and must not hold a closing server open.
  let selections = new Set<() => void>()
  let select = (): Promise<Capture | undefined> => {
    let choice = Promise.withResolvers<Capture | undefined>()
    let cancel = () => choice.resolve(undefined)
    selections.add(cancel)
    void options.take().then(
      (value) => choice.resolve(value),
      () => choice.resolve({ requested: false, rate: 0 }),
    ).finally(() => selections.delete(cancel))
    return choice.promise
  }
  let complete = async (
    events: Event[],
    capture: Promise<Capture | undefined>,
  ) => {
    let root = events[0]
    if (!root) return
    let armed = await capture
    if (!armed) return
    let rowsRead = root.counts?.rowsRead ?? 0
    let rowsWritten = root.counts?.rowsWritten ?? 0
    let selected = selectRequest({
      op: root.kind,
      name: root.name,
      now: now(),
      rowsRead,
      rowsWritten,
      ...armed,
      random: random(),
    }, quota)
    quota = selected.state
    if (!selected.reason || !options.sink) return
    let rows = sampleRequest(events, {
      origin,
      eid: crypto.randomUUID(),
      during: { process: options.process },
      rowsRead,
      rowsWritten,
      requested: true,
      repeats: selected.repeats,
    })
    if (rows) await options.sink(rows as Bundle[])
  }
  let stop = channel(graph).subscribe((event) => {
    if (
      ['get', 'sql'].includes(event.kind) && event.stage == 'start' &&
      options.getStart?.(event)
    ) {
      let errors = Error as ErrorConstructor & { stackTraceLimit?: number }
      let before = errors.stackTraceLimit
      let stack: string
      try {
        errors.stackTraceLimit = 48
        stack = (new Error('armed get start').stack ?? '').slice(0, 8192)
      } finally {
        errors.stackTraceLimit = before
      }
      if (options.reportGetStart) options.reportGetStart(stack)
      else {console.error(
          JSON.stringify({ diagnostic: 'get-start', pid: Deno.pid, stack }),
        )}
    }
    let root = roots.get(event.id) ?? (event.parent && roots.get(event.parent))
    if (!root && ['request', 'apply', 'effect'].includes(event.kind)) {
      root = event.id
      if (event.stage != 'start') return
      trees.set(root, {
        events: new Map(),
        capture: select(),
      })
    }
    if (!root) return
    let tree = trees.get(root)
    if (!tree) return
    roots.set(event.id, root)
    tree.events.set(event.id, event)
    if (tree.events.size > HOLD) trim(tree.events)
    if (event.id != root || event.stage == 'start') return
    trees.delete(root)
    for (let id of tree.events.keys()) roots.delete(id)
    // No graph reads, writes or projection on the unselected path. Failures
    // here must not recursively report into the same spool.
    let work = complete([...tree.events.values()], tree.capture).catch(
      (error) => {
        console.error('trace delivery failed —', error)
      },
    ).finally(() => pending.delete(work))
    pending.add(work)
  }, { history: false })
  return {
    close: async () => {
      stop()
      // A selection already resolved has priority over cancellation.
      await Promise.resolve()
      selections.forEach((cancel) => cancel())
      selections.clear()
      trees.clear()
      roots.clear()
      await Promise.all(pending)
    },
  }
}
