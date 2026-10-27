// Native harness overhead, excluding provider latency and the command itself.
// Fixed bounds come from the same committed reference as the bench, with the
// noise it measured. A phase is judged by what load does not move: its wall
// time less what this process's thread waited for a CPU over it, so a loaded
// box neither hides an excess nor makes one.
import type { Bundle, Comp } from '@yaks/graph'
import { hook } from '@yaks/graph'
import type { Host } from '@yaks/host'
import {
  type Baseline,
  limit as benchmarkLimit,
  median,
  waited,
} from '@yaks/benchmark'
import type { Runner, Step } from '@yaks/session'
import { applied } from '@yaks/journal'
import { logFor } from '@yaks/journal/graph'
import reference from './steps.baseline.json' with {
  type: 'json',
}

export type Overhead = {
  step: string
  metric: 'dispatch' | 'preflight' | 'tool-overhead'
  ms: number
}
const toolReference = reference.benches.find((b) => b.name == 'tool-step')!
export const overheadLimit: number = benchmarkLimit(
  reference as Baseline,
  toolReference as Baseline['benches'][number],
)
const comp = (b: Bundle, k: string) => b[k] as Comp | undefined
const at = (b: Bundle) => Date.parse(String(comp(b, 'created')?.at))
export type Mark = { at: number; patch: Bundle }
/** What load took from the work between two instants (ms since the epoch). */
export type Wait = (from: number, to: number) => number

/** Exact claim/release history; missing boundaries produce no estimate. Each
 * phase is its wall time less what `wait` says load took from it. */
export const overheadSamples = (
  entries: Bundle[],
  marks: Mark[],
  inputs = new Set<string>(),
  wait: Wait = () => 0,
): Overhead[] => {
  const span = (from: number, to: number) => to - from - wait(from, to)
  const rows = entries.toSorted((a, b) =>
    Number(comp(a, 'entry')?.seq) - Number(comp(b, 'entry')?.seq)
  )
  const history = (id: string, component: string, held: boolean) =>
    marks.filter((m) =>
      m.patch.entity.eid == id &&
      (held
        ? !!comp(m.patch, component)?.by
        : comp(m.patch, component)?.by === null)
    ).at(-1)?.at
  const samples: Overhead[] = []
  for (const row of rows) {
    const id = row.entity.eid
    if (row.call) {
      const claim = history(id, 'execution', true)
      if (claim !== undefined && claim >= at(row)) {
        samples.push({ step: id, metric: 'dispatch', ms: span(at(row), claim) })
      }
    }
    if (row.result) {
      const r = comp(row, 'result')!
      const claim = history(String(r.call), 'execution', true)
      if (claim !== undefined && typeof r.ms == 'number') {
        const ms = span(claim, at(row)) - r.ms
        if (ms >= 0) samples.push({ step: id, metric: 'tool-overhead', ms })
      }
    }
    if (row.ask) {
      const index = rows.indexOf(row)
      const before = rows.slice(0, index)
      const priorAsk = before.findLast((b) => b.ask)
      const claim = history(id, 'attempt', true)
      const result = before.findLast((b) => b.result && !b.tool_progress)
      if (claim === undefined || !result) continue
      const after = before.slice(before.indexOf(result) + 1)
      if (after.some((b) => inputs.has(b.entity.eid))) continue
      const release = priorAsk
        ? history(priorAsk.entity.eid, 'attempt', false)
        : undefined
      // A final received during inference does not turn remaining provider wait
      // into preflight. Nor does an old result justify timing an owner idle gap.
      if (priorAsk && (release === undefined || at(priorAsk) > at(result))) {
        continue
      }
      const ms = span(Math.max(at(result), release ?? at(result)), claim)
      if (ms >= 0) samples.push({ step: id, metric: 'preflight', ms })
    }
  }
  return samples
}

/** How many of a session's newest samples of a phase are judged together. */
export const RECENT = 5

/// overheadDue(new Map([['s dispatch', [60, 60, 60, 60]]]), 's dispatch', 60) -> true
/// overheadDue(new Map([['s dispatch', [60, 60, 9, 9]]]), 's dispatch', 9) -> false
/// overheadDue(new Map(), 's dispatch', 999) -> false
/** Whether a phase is over its reference now: the median of a session's
 * newest {@link RECENT} samples of it (kept under `key` in `recent`) is over
 * the limit, as the bench judges the median of its steps. A whole benchmark
 * tool step conservatively bounds each constituent phase; one slow step is
 * noise, and a typical one over the limit is not. */
export const overheadDue = (
  recent: Map<string, number[]>,
  key: string,
  ms: number,
  limit = overheadLimit,
): boolean => {
  const newest = [...recent.get(key) ?? [], ms].slice(-RECENT)
  recent.delete(key)
  recent.set(key, newest)
  // a worker keeps the phases of the sessions it ran most recently
  for (const old of recent.keys()) {
    if (recent.size <= 256) break
    recent.delete(old)
  }
  return newest.length == RECENT && median(newest) > limit
}

/** What load took from this thread between two instants, from readings of
 * `waited` (@yaks/benchmark) noted at commits: the first reading at or after
 * each instant. Where either has none, nothing is known and nothing taken. */
export const waits = (
  read: () => number | undefined = waited,
  now: () => number = Date.now,
  size = 1024,
): { note: () => void; between: Wait } => {
  const readings: [number, number][] = []
  const after = (t: number) => readings.find(([at]) => at >= t)?.[1]
  return {
    note: () => {
      const w = read()
      if (w === undefined) return
      readings.push([now(), w])
      if (readings.length > size) readings.shift()
    },
    between: (from, to) => {
      const a = after(from), b = after(to)
      return a === undefined || b === undefined ? 0 : Math.max(0, b - a)
    },
  }
}

/** Read only a bounded scalar tail. One report per metric per worker; the fixed
 * message groups recurrence in the tracker, not one bug per observation. */
export const overheadEach = (
  host: Host,
  each?: Runner['each'],
): NonNullable<Runner['each']> => {
  const recent = new Map<string, number[]>()
  // A phase reports once per worker; a sample counts once, though both the
  // step that wrote a line and the next one see it.
  const reported = new Set<string>(), judged = new Set<string>()
  // Every phase starts and ends at a commit that writes a transcript line, a
  // call's execution or an ask's attempt; a reading at each bounds its wait.
  const load = waits()
  host.graph.use({
    name: '@yaks/harness/overhead',
    admission: () => true,
    hooks: {
      commit: hook(
        ['entry', 'execution', 'attempt'],
        (bundles) => (load.note(), bundles),
      ),
    },
  })
  const failed = (session: string, error: unknown) =>
    host.report?.(error, {
      during: { session },
      tags: { handler: 'native-overhead' },
    })
  const judge = (session: string, sample: Overhead) => {
    const id = `${sample.metric} ${sample.step}`
    if (judged.has(id)) return
    judged.add(id)
    if (judged.size > 1024) judged.delete(judged.values().next().value!)
    const key = `${session} ${sample.metric}`
    if (!overheadDue(recent, key, sample.ms) || reported.has(sample.metric)) {
      return
    }
    reported.add(sample.metric)
    // The next step never waits on a report's delivery.
    Promise.resolve()
      .then(() =>
        host.report?.(
          new Error(
            `Native ${sample.metric} overhead exceeded its benchmark reference`,
          ),
          {
            during: { session },
            tags: {
              metric: sample.metric,
              step: sample.step,
              ms: sample.ms,
              median: median(recent.get(key)!),
              limit: overheadLimit,
              reference: 'harness-steps/tool-step',
            },
          },
        )
      )
      .catch((error) => failed(session, error))
      .catch((failure) => console.error('overhead reporter failed', failure))
  }
  return async (step: Step, session?: string) => {
    await each?.(step, session)
    if (!session || step.did == 'nothing') return
    try {
      const rows = await host.graph.read(
        `.entry.session=${session}&.fields=entity.eid,entry.seq,ask.through,call.source,result.call,result.ms,tool_progress.call,created.at&.order=-entry.seq&.limit=24`,
      )
      const first = Math.min(...rows.map((b) => Number(comp(b, 'entry')?.seq)))
      const input = await host.graph.read(
        `.entry.session=${session}&.entry.seq>=${first}&.content&!output&!call&!ask&!result&!tool_progress&!reasoning&.fields=entity.eid&.limit=24`,
      )
      const journal = logFor(host)
      const marks: Mark[] = []
      const added = new Set(step.added.map((b) => b.entity.eid))
      const needed = new Set(step.added.flatMap((b) => [
        ...b.ask || b.call ? [b.entity.eid] : [],
        ...comp(b, 'result')?.call ? [String(comp(b, 'result')!.call)] : [],
      ]))
      const priorAsk = rows.filter((b) =>
        b.ask && !added.has(b.entity.eid)
      ).sort((a, b) =>
        Number(comp(b, 'entry')?.seq) - Number(comp(a, 'entry')?.seq)
      )[0]
      if (priorAsk) needed.add(priorAsk.entity.eid)
      for (const row of rows.filter((b) => needed.has(b.entity.eid))) {
        for (const tx of journal.history(row.entity.eid, 16)) {
          for (const patch of applied(tx)) {
            if (
              patch.entity.eid == row.entity.eid &&
              (patch.attempt || patch.execution)
            ) {
              marks.push({ at: Date.parse(tx.at), patch })
            }
          }
        }
      }
      for (
        const sample of overheadSamples(
          rows,
          marks,
          new Set(input.map((b) => b.entity.eid)),
          load.between,
        )
      ) {
        if (!added.has(sample.step) && !needed.has(sample.step)) continue
        judge(session, sample)
      }
    } catch (error) {
      await failed(session, error)
    }
  }
}
