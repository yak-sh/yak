/** Benchmark consumer for timing delivery: retain completed minute events and
 * root-first trees, then summarize and sample without tracker I/O. Each graph
 * has channel-local IDs; the process shares its minute buffer and sample quota. */
import { sample, summarize, type TimingRow, type Trace } from '@yaks/timing'
import { channel, type Event } from '@yaks/trace'

export let applyRecording = (targets: readonly object[]) => {
  let origin = performance.timeOrigin
  let process = '00000000-0000-4000-8000-000000064928'
  let events: Event[] = []
  let open = new Map<Map<string, Event>, number>()
  let sampled: ReadonlySet<string> = new Set()
  let rows: TimingRow[] = []
  let traces: Trace[] = []
  let minute: number | undefined
  let flush = (before: number) => {
    rows.push(...summarize(events, { process, origin, before }))
    events = events.filter((e) => origin + e.time >= before)
    // Sampling uses the root's start minute. Keep its quota until every root
    // from that minute has closed, even when its completion minute is later.
    let earliest = Math.min(before, ...open.values())
    sampled = new Set(
      [...sampled].filter((key) => JSON.parse(key)[1] >= earliest),
    )
  }
  let stops = targets.map((target) => {
    let trees = new Map<string, Map<string, Event>>()
    let roots = new Map<string, string>()
    return channel(target).subscribe((e) => {
      let at = Math.floor((origin + e.time) / 60_000) * 60_000
      if (minute != null && at > minute) flush(at)
      minute = at
      if (e.stage != 'start') events.push(e)
      let root = e.parent ? roots.get(e.parent) : e.id
      if (!root) return
      let tree = trees.get(root)
      if (!tree) {
        tree = new Map()
        trees.set(root, tree)
        open.set(
          tree,
          Math.floor((origin + (e.start ?? e.time)) / 60_000) * 60_000,
        )
      }
      roots.set(e.id, root)
      tree.set(e.id, e)
      if (e.id != root || e.stage == 'start') return
      let selected = sample([...tree.values()], { origin }, sampled)
      sampled = selected.sampled
      if (selected.trace) traces.push(selected.trace)
      for (let id of tree.keys()) roots.delete(id)
      trees.delete(root)
      open.delete(tree)
    })
  })
  return {
    // Close a finite minute of fresh workloads inside timing, amortizing the
    // shared summary and ordinary tree without waiting for a wall-clock minute.
    finish: () => {
      if (minute != null) flush(minute + 60_000)
      return { rows, traces }
    },
    stop: () => {
      for (let stop of stops) stop()
    },
  }
}
