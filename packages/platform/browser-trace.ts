// What a page's main thread did while a visit's steps ran, from Chrome's
// trace (CDP `Tracing`): each task that held it over `LONG` ms, with its time
// split by what it spent it on. A long frame says how long style and layout
// took and which scripts held it; a trace says the rest: the frame callbacks
// and observers too small for a frame's script list, paint, and the garbage
// collector.

import type { Session } from './browser-visit.ts'

/** A task worth a line: one that held the main thread this long, in ms. */
export let LONG = 30

/** The categories a visit's trace records: the timeline DevTools draws, and
 * the page's own marks to place it. */
export let CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'blink.user_timing',
  'toplevel',
  'v8.execute',
]

/** One event of a trace, as Chrome writes it: times in microseconds. */
export type TraceEvent = {
  name: string
  ph: string
  ts: number
  dur?: number
  pid: number
  tid: number
  args?: { name?: string; data?: { url?: string } }
}

/** One long task: when it started (ms on the page's clock), how long it
 * took, and its time by what it was spent on, the most first. */
export type Task = { at: number; ms: number; spent: [string, number][] }

// Script runs under these: their own time is the script's, named by the
// file of the nearest one that says it.
let SCRIPT = new Set([
  'FunctionCall',
  'EvaluateScript',
  'v8.compile',
  'v8.compileModule',
  'v8.evaluateModule',
  'v8.callFunction',
  'v8.run',
  'TimerFire',
  'FireAnimationFrame',
  'FireIdleCallback',
  'EventDispatch',
  'RunMicrotasks',
  'V8.Execute',
  'XHRReadyStateChange',
])

// What a timeline event is, in the words a line uses.
let WORDS: Record<string, string> = {
  UpdateLayoutTree: 'style',
  RecalculateStyles: 'style',
  Layout: 'layout',
  PrePaint: 'prepaint',
  Paint: 'paint',
  PaintImage: 'paint',
  Layerize: 'layerize',
  UpdateLayer: 'layerize',
  Commit: 'commit',
  HitTest: 'hit-test',
  ParseHTML: 'parse',
  ParseAuthorStyleSheet: 'parse-css',
  MajorGC: 'gc',
  MinorGC: 'gc',
  'V8.GC_SCAVENGER': 'gc',
  'Decode Image': 'decode',
  'ResizeObserver::BroadcastObservations': 'resize-observer',
  'IntersectionObserverController::computeIntersections': 'intersections',
  ScheduleStyleRecalculation: 'style',
}

let file = (url: string) => url.split('/').pop()!.split('?')[0] || url

/** The long tasks on the page's main thread in `events`, each placed on the
 * page's clock by the mark `zero` names: `ms` is where that mark stood. */
export let tasks = (
  events: TraceEvent[],
  zero: { name: string; ms: number },
): Task[] => {
  let main = events.find((e) =>
    e.ph == 'M' && e.name == 'thread_name' && e.args?.name == 'CrRendererMain'
  )
  if (!main) return []
  let mark = events.find((e) => e.name == zero.name)
  let on = (e: TraceEvent) => e.pid == main.pid && e.tid == main.tid
  let complete = events
    .filter((e) => on(e) && e.ph == 'X' && e.dur != null)
    .sort((a, b) => a.ts - b.ts || b.dur! - a.dur!)
  let at = (ts: number) =>
    Math.round(((ts - (mark?.ts ?? ts)) / 1000 + zero.ms) * 10) / 10
  let ms = (us: number) => Math.round(us / 100) / 10
  let out: Task[] = []
  for (let task of complete) {
    if (task.name != 'RunTask' || task.dur! < LONG * 1000) continue
    let end = task.ts + task.dur!
    let inside = complete.filter((e) =>
      e != task && e.ts >= task.ts && e.ts + e.dur! <= end
    )
    // Each event's own time: its length less its children's, walked as a
    // stack, so a parent's time is never counted twice.
    let spent = new Map<string, number>()
    let add = (label: string, us: number) =>
      spent.set(label, (spent.get(label) ?? 0) + us)
    let stack: { e: TraceEvent; label: string; own: number }[] = [
      { e: task, label: 'task', own: task.dur! },
    ]
    let close = (until: number) => {
      while (stack.length > 1) {
        let top = stack.at(-1)!
        if (top.e.ts + top.e.dur! > until) break
        stack.pop()
        add(top.label, top.own)
      }
    }
    for (let e of inside) {
      close(e.ts)
      let parent = stack.at(-1)!
      parent.own -= e.dur!
      let url = e.args?.data?.url
      let label = SCRIPT.has(e.name)
        ? url
          ? `js ${file(url)}`
          : parent.label.startsWith('js ')
          ? parent.label
          : 'js'
        : WORDS[e.name] ??
          (parent.label.startsWith('js ') ? parent.label : e.name)
      stack.push({ e, label, own: e.dur! })
    }
    close(Infinity)
    add('task', stack[0].own)
    out.push({
      at: at(task.ts),
      ms: ms(task.dur!),
      spent: [...spent]
        .map(([label, us]) => [label, ms(us)] as [string, number])
        .filter(([, n]) => n >= 1)
        .sort((a, b) => b[1] - a[1]),
    })
  }
  return out
}

/** Start tracing the page `cdp` drives; the answer stops it and says its
 * long tasks. */
export let tracing = async (
  cdp: Session,
): Promise<() => Promise<Task[]>> => {
  let events: TraceEvent[] = []
  cdp.on('Tracing.dataCollected', ({ value }: { value: TraceEvent[] }) => {
    events.push(...value)
  })
  await cdp.send('Tracing.start', {
    categories: CATEGORIES.join(','),
    transferMode: 'ReportEvents',
  })
  let { result } = await cdp.send('Runtime.evaluate', {
    expression: "performance.mark('yak-trace').startTime",
    returnByValue: true,
  })
  return async () => {
    let done = new Promise((resolve) =>
      cdp.on('Tracing.tracingComplete', resolve)
    )
    await cdp.send('Tracing.end')
    await done
    return tasks(events, { name: 'yak-trace', ms: Number(result.value) || 0 })
  }
}
