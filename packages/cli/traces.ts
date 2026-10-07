// Box telemetry observes the runtime channel, never the watched database.
// Selection happens after a root completes; all unselected trees die in memory.
import { type Bundle } from '@yaks/graph'
import { type RequestState, sampleRequest, selectRequest } from '@yaks/timing'
import { channel, type Event } from '@yaks/trace'
import type { Sink } from '@yaks/tracker/report'

export type Capture = { requested: boolean; rate: number }
export type Traces = { close: () => Promise<void> }

export let traces = (
  graph: object,
  options: {
    process: string
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
    capture: Promise<Capture>
  }>()
  let pending = new Set<Promise<void>>()
  let complete = async (events: Event[], capture: Promise<Capture>) => {
    let root = events[0]
    if (!root) return
    let armed = await capture
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
    let root = roots.get(event.id) ?? (event.parent && roots.get(event.parent))
    if (!root && ['request', 'apply', 'effect'].includes(event.kind)) {
      root = event.id
      if (event.stage != 'start') return
      trees.set(root, {
        events: new Map(),
        capture: options.take().catch(() => ({
          requested: false,
          rate: 0,
        })),
      })
    }
    if (!root) return
    let tree = trees.get(root)
    if (!tree) return
    roots.set(event.id, root)
    tree.events.set(event.id, event)
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
      trees.clear()
      roots.clear()
      await Promise.all(pending)
    },
  }
}
