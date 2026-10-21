// Native harness overhead, excluding provider latency and the command itself.
// Fixed bounds come from the same committed reference as the bench, with the
// noise it measured, and an excess counts as the bench's does: repeated, on a
// box that was not loaded.
import type { Bundle, Comp } from '@yaks/graph'
import type { Host } from '@yaks/host'
import {
  type Baseline,
  busy,
  limit as benchmarkLimit,
  loaded,
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

/** Exact claim/release history; missing boundaries produce no estimate. */
export const overheadSamples = (
  entries: Bundle[],
  marks: Mark[],
  inputs = new Set<string>(),
): Overhead[] => {
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
        samples.push({ step: id, metric: 'dispatch', ms: claim - at(row) })
      }
    }
    if (row.result) {
      const r = comp(row, 'result')!
      const claim = history(String(r.call), 'execution', true)
      if (claim !== undefined && typeof r.ms == 'number') {
        const ms = at(row) - claim - r.ms
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
      const ms = claim - Math.max(at(result), release ?? at(result))
      if (ms >= 0) samples.push({ step: id, metric: 'preflight', ms })
    }
  }
  return samples
}

/** A whole benchmark tool step conservatively bounds each constituent phase. */
export const overheadExcess = (samples: Overhead[], limit = overheadLimit) =>
  samples.filter((s) => s.ms > limit)

/// overheadDue(new Map([['dispatch', 1]]), 'dispatch') ~> true
/// overheadDue(new Map(), 'dispatch') ~> false
/// overheadDue(new Map([['dispatch', 1]]), 'dispatch', async () => true) ~> false
/** Whether a metric's excess reports now: once, on its second excess in a
 * worker, and not while the box is loaded, when the excess is not counted and
 * the next one is judged again. One slow step is noise until another repeats
 * it, and a loaded box times its other work. `crowded` is asked only then. */
export const overheadDue = async (
  seen: Map<string, number>,
  metric: string,
  crowded: () => Promise<boolean> = () => Promise.resolve(false),
): Promise<boolean> => {
  const n = (seen.get(metric) ?? 0) + 1
  if (n == 2 && await crowded()) return false
  seen.set(metric, n)
  return n == 2
}

/** Whether other work keeps the box loaded, from a second of its CPU use
 * (@yaks/benchmark `busy` and `loaded`). */
const crowded = async () => loaded({ busy: await busy() ?? null })

/** Read only a bounded scalar tail. One report per metric per worker; the fixed
 * message groups recurrence in the tracker, not one bug per observation. */
export const overheadEach = (
  host: Host,
  each?: Runner['each'],
): NonNullable<Runner['each']> => {
  const seen = new Map<string, number>()
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
        const sample of overheadExcess(
          overheadSamples(rows, marks, new Set(input.map((b) => b.entity.eid))),
        )
      ) {
        if (
          (!added.has(sample.step) && !needed.has(sample.step)) ||
          !(await overheadDue(seen, sample.metric, crowded))
        ) continue
        await host.report?.(
          new Error(
            `Native ${sample.metric} overhead exceeded its benchmark reference`,
          ),
          {
            during: { session },
            tags: {
              metric: sample.metric,
              step: sample.step,
              ms: sample.ms,
              limit: overheadLimit,
              reference: 'harness-steps/tool-step',
            },
          },
        )
      }
    } catch (error) {
      await host.report?.(error, {
        during: { session },
        tags: { handler: 'native-overhead' },
      })
    }
  }
}
