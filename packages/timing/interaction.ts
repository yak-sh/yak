// Browser measurements use the same additive timing rows as server spans.
// Exact threshold counts sit beside the logarithmic histogram.
import type { Bundle } from '@yaks/graph'
import { minute, type TimingRow } from './model.ts'
import { type Measure, summarize } from './summary.ts'

export let INTERACTION = 'interaction' as const
export let OPEN = 'open' as const
export let FRAME = 16
export let SLOW = 100
export let MAX_POINTS = 24
export let MAX_MS = 60_000
export let INTERACTION_PATH = '/api/interaction'

export type Point = {
  page: string
  target: string
  ms: number
  input: number
  server: number
  script: number
  render: number
}
export let OPEN_PATH: string = INTERACTION_PATH + '?open=1'
export let OPEN_SOURCES = ['cold', 'picture', 'shell', 'push'] as const
export let DEVICES = ['iphone-compact', 'phone', 'tablet', 'desktop'] as const
export type Open = {
  source: typeof OPEN_SOURCES[number]
  picture: boolean
  device: typeof DEVICES[number]
  installed: boolean
  paint: number | null
  usable: number | null
  server: number | null
  estimated: boolean
  // a service worker answered the page's address, as the page says
  controlled?: boolean
}
export type Batch = { id: string; at: number; points: Point[]; open?: Open }
export type Phases = Pick<Point, 'input' | 'server' | 'script' | 'render'>

/** Split one elapsed interval, accounting for each millisecond once. The
 * input delay and server wait are measured, and render is the remaining
 * time between committing the result and its frame. */
export let phases = (
  ms: number,
  input: number,
  server: number,
  render: number,
): Phases => {
  input = Math.min(ms, Math.max(0, input))
  server = Math.min(ms - input, Math.max(0, server))
  render = Math.min(ms - input - server, Math.max(0, render))
  return { input, server, render, script: ms - input - server - render }
}

export let interactionName = (
  { page, target }: Pick<Point, 'page' | 'target'>,
): string => `${page} → ${target}`

// T-3503's fast-4G runs: 152–512 ms to the picture and 945–1441 ms
// to a fresh reopen, with cold paint and usable usually within 2.1 and 3.3 s.
// T-3578's live shell painted in 60–140 ms: a page drawn from the phone
// paints within a few hundred. A shell is usable when a cold page is.
// The existing under100 count tracks the picture's paint goal.
export let openMilestones = (
  open: Open,
): { name: string; ms: number | null; budget: number }[] => {
  let paint = open.picture ? 400 : 2200
  let usable = open.picture && open.source != 'shell' ? 1500 : 3500
  return [
    { name: 'paint', ms: open.paint, budget: paint },
    { name: 'usable', ms: open.usable, budget: usable },
  ]
}

export let openName = (page: string, open: Open, milestone: string): string =>
  interactionName({
    page,
    target: `open ${open.source}${
      open.source == 'push' && open.picture ? ' picture' : ''
    } ${open.device} ${milestone}`,
  })

export let interactionRows = (
  { id, at, points, open }: Batch,
  commit?: string,
  opened?: { page: string; person?: string | null },
): TimingRow[] => {
  let events = points.map((p): Measure => ({
    kind: INTERACTION,
    name: interactionName(p),
    stage: 'end',
    time: 0,
    duration: p.ms,
    counts: {
      under16: Number(p.ms < FRAME),
      under100: Number(p.ms < SLOW),
      input: p.input,
      server: p.server,
      script: p.script,
      render: p.render,
    },
  }))
  if (open && opened) {
    for (let { name, ms, budget } of openMilestones(open)) {
      events.push({
        kind: OPEN,
        name: openName(opened.page, open, ms == null ? `no ${name}` : name),
        stage: 'end',
        time: 0,
        duration: ms ?? 0,
        counts: {
          under16: Number(ms != null && ms < FRAME),
          under100: Number(ms != null && ms < SLOW),
          overBudget: Number(ms != null && ms > budget),
          installed: Number(open.installed),
          ...open.controlled == null
            ? {}
            : { controlled: Number(open.controlled) },
          ...name == 'paint'
            ? {
              estimated: Number(open.estimated && ms != null),
              ...open.server == null ? {} : { server: open.server },
            }
            : {},
        },
      })
    }
  }
  let rows = summarize(events, {
    process: id,
    origin: at,
    before: minute(at) + 60_000,
    commit,
  })
  let person = opened?.person
  return open && person
    ? rows.map((row) => ({
      ...row,
      during: { ...row.during, entity: person },
    }))
    : rows
}

export type InteractionKind = {
  name: string
  n: number
  max: number
  total: number
}
export type InteractionSummary = {
  n: number
  under16: number
  under100: number
  kinds: InteractionKind[]
}

/** Merge all interaction batches in a window and rank kinds by their peak. */
export let interactionSummary = (rows: Bundle[]): InteractionSummary => {
  let kinds = new Map<string, InteractionKind>()
  let total = { n: 0, under16: 0, under100: 0 }
  for (let row of rows) {
    let t = row.timing as Partial<TimingRow['timing']> | undefined
    if (t?.op != INTERACTION || !t.name || !t.n) continue
    let held = kinds.get(t.name) ?? { name: t.name, n: 0, max: 0, total: 0 }
    held.n += t.n
    held.max = Math.max(held.max, t.max ?? 0)
    held.total += t.total ?? 0
    kinds.set(t.name, held)
    total.n += t.n
    total.under16 += t.counts?.under16 ?? 0
    total.under100 += t.counts?.under100 ?? 0
  }
  return {
    ...total,
    kinds: [...kinds.values()].sort((a, b) =>
      b.max - a.max || b.total / b.n - a.total / a.n ||
      a.name.localeCompare(b.name)
    ),
  }
}
