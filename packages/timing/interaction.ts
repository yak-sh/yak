// Browser measurements use the same additive timing rows as server spans.
// Exact threshold counts sit beside the logarithmic histogram.
import type { Bundle } from '@yaks/graph'
import { minute, type TimingRow } from './model.ts'
import { type Measure, summarize } from './summary.ts'

export let INTERACTION = 'interaction' as const
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
export type Batch = { id: string; at: number; points: Point[] }
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

export let interactionRows = (
  { id, at, points }: Batch,
  commit?: string,
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
  return summarize(events, {
    process: id,
    origin: at,
    before: minute(at) + 60_000,
    commit,
  })
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
