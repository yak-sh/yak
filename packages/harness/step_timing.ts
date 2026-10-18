// Native step timing from bounded transcript tails and exact journal marks.
// Each metric is compared only with its own preceding samples.

import type { Bundle, Comp } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { Host } from '@yaks/host'
import type { Runner } from '@yaks/session'
import { applied } from '@yaks/journal'
import { logFor } from '@yaks/journal/graph'

/** Durations are independent: model claim→release, call creation→claim,
 * tool result.ms, and final result→next model claim without intervening input. */
export type StepTiming = {
  step: string
  metric: 'model' | 'dispatch' | 'tool' | 'preflight'
  ms: number
  at: number
}

/** Exact journal claim/release marks, not mutable updated stamps. */
export type StepMark = { at: number; patch: Bundle }

let component = (b: Bundle, name: string) => b[name] as Comp | undefined
let timestamp = (b: Bundle) => Date.parse(String(component(b, 'created')?.at))

/** Pure derivation. Missing releases and incomplete tails produce no guesses. */
export let stepTimings = (
  entries: Bundle[],
  marks: StepMark[],
  inputs: Set<string> = new Set(),
): StepTiming[] => {
  let samples: StepTiming[] = []
  let rows = [...entries].sort((a, b) =>
    Number(component(a, 'entry')?.seq) - Number(component(b, 'entry')?.seq)
  )
  for (let row of rows) {
    let step = row.entity.eid
    let history = marks.filter((m) => m.patch.entity.eid == step)
      .sort((a, b) => a.at - b.at)
    for (let name of ['attempt', 'execution']) {
      let claim: number | undefined
      for (let mark of history) {
        if (!(name in mark.patch)) continue
        let value = component(mark.patch, name)
        if (value?.by && claim == undefined) {
          claim = mark.at
          if (name == 'execution' && row.call) {
            let ms = claim - timestamp(row)
            if (ms >= 0) {
              samples.push({ step, metric: 'dispatch', ms, at: claim })
            }
          }
          if (name == 'attempt' && row.ask) {
            let preceding = rows.filter((b) =>
              Number(component(b, 'entry')?.seq) <
                Number(component(row, 'entry')?.seq)
            )
            let lastAsk = preceding.findLastIndex((b) => b.ask)
            preceding = preceding.slice(lastAsk + 1)
            let previous = preceding.findLast((b) =>
              b.result && !b.tool_progress
            )
            let after = previous
              ? preceding.slice(preceding.indexOf(previous) + 1)
              : []
            let input = after.some((b) => inputs.has(b.entity.eid))
            if (previous && !input) {
              let ms = claim - timestamp(previous)
              if (ms >= 0) {
                samples.push({ step, metric: 'preflight', ms, at: claim })
              }
            }
          }
        } else if ((!value || value.by === null) && claim != undefined) {
          if (name == 'attempt' && row.ask) {
            samples.push({
              step,
              metric: 'model',
              ms: mark.at - claim,
              at: mark.at,
            })
          }
          claim = undefined
        }
      }
    }
    let result = component(row, 'result')
    if (
      result && typeof result.ms == 'number' && result.ms >= 0 &&
      !row.tool_progress
    ) {
      samples.push({ step, metric: 'tool', ms: result.ms, at: timestamp(row) })
    }
  }
  return samples.sort((a, b) => a.at - b.at)
}

let median = (values: number[]) => {
  let ordered = [...values].sort((a, b) => a - b)
  let mid = Math.floor(ordered.length / 2)
  return ordered.length % 2
    ? ordered[mid]
    : (ordered[mid - 1] + ordered[mid]) / 2
}

/** Zero slack: three consecutive same-metric samples exceed the prior median. */
export let stepDrift = (
  samples: StepTiming[],
): (StepTiming & { baseline: number })[] => {
  let drift: (StepTiming & { baseline: number })[] = []
  for (let metric of ['model', 'dispatch', 'tool', 'preflight'] as const) {
    let same = samples.filter((s) => s.metric == metric)
    for (let i = 5; i < same.length; i++) {
      let prior = same.slice(Math.max(0, i - 8), i - 2)
      let baseline = median(prior.map((s) => s.ms))
      if (same.slice(i - 2, i + 1).every((s) => s.ms > baseline)) {
        drift.push({ ...same[i], baseline })
      }
    }
  }
  return drift
}

/** Collect only the newest 48 transcript entries and 48 journal transactions per
 * ask/call. A claim outside that bounded history is omitted, never estimated. */
export let stepTimingReporter = (host: Host) => {
  let seen = new Set<string>()
  return async (session: string): Promise<void> => {
    let entries = await host.graph.read(
      `.entry.session=${session}&.fields=entity.eid,entry.seq,ask.through,call.source,result.ms,result.call,tool_progress.call,created.at&.order=-entry.seq&.limit=48`,
    )
    if (!entries.length) return
    let first = Math.min(
      ...entries.map((b) => Number(component(b, 'entry')?.seq)),
    )
    // Presence filters classify input/notice without loading any content bodies.
    let boundaries = await host.graph.read(
      `.entry.session=${session}&.entry.seq>=${first}&.content&!ask&!call&!result&!output&!reasoning&!tool_progress&.fields=entity.eid,entry.seq&.order=-entry.seq&.limit=48`,
    )
    let inputs = new Set(boundaries.map((b) => b.entity.eid))
    let journal = logFor(host)
    let marks: StepMark[] = []
    for (let row of entries.filter((b) => b.ask || b.call)) {
      for (let change of journal.history(row.entity.eid, 48)) {
        for (let patch of applied(change)) {
          if (patch.entity.eid == row.entity.eid) {
            marks.push({ at: Date.parse(change.at), patch })
          }
        }
      }
    }
    for (let sample of stepDrift(stepTimings(entries, marks, inputs))) {
      let key = `${session}|${sample.step}|${sample.metric}`
      if (seen.has(key)) continue
      let row = entries.find((b) => b.entity.eid == sample.step)!
      let call = sample.metric == 'tool'
        ? entries.find((b) => b.entity.eid == component(row, 'result')?.call)
        : row
      seen.add(key)
      try {
        await host.report?.(
          new Error(
            `Native ${sample.metric} timing drift: ${sample.ms}ms > ${sample.baseline}ms prior median`,
          ),
          {
            eid: derivedEid(`step-timing|${key}`),
            during: { session },
            tags: {
              metric: sample.metric,
              step: sample.step,
              ms: sample.ms,
              baseline: sample.baseline,
              request: sample.metric == 'model' || sample.metric == 'preflight'
                ? sample.step
                : call && component(call, 'call')?.source,
              call: sample.metric == 'tool'
                ? component(row, 'result')?.call
                : sample.metric == 'dispatch'
                ? sample.step
                : undefined,
              result: sample.metric == 'tool' ? sample.step : undefined,
            },
          },
        )
      } catch (error) {
        seen.delete(key)
        throw error
      }
      if (seen.size > 192) seen.delete(seen.values().next().value!)
    }
  }
}

/** Await observation before a step returns; telemetry cannot change its final. */
export let stepTimingEach = (
  host: Host,
  each?: Runner['each'],
  collect = stepTimingReporter(host),
): NonNullable<Runner['each']> =>
async (step, session) => {
  await each?.(step, session)
  if (!session || step.did == 'nothing') return
  try {
    await collect(session)
    await unfinishedNativeFinal(host, session, step)
  } catch (error) {
    try {
      await host.report?.(error, {
        during: { session },
        tags: { handler: 'step_timing' },
      })
    } catch (failure) {
      console.error('step_timing reporter failed', failure)
    }
  }
}

/** A native final with unblocked claimed work is not successful completion.
 * Report the idle handoff; do not resume it automatically or spend another turn. */
export let unfinishedNativeFinal = async (
  host: Host,
  session: string,
  step: import('@yaks/session').Step,
): Promise<void> => {
  if (step.status != 'settled' || step.did != 'asked') return
  let [native] = await host.graph.read(
    `.entity.eid=${session}&.native&.fields=entity.eid`,
  )
  if (!native) return
  let tasks = await host.graph.read(
    `.task&.claim.session=${session}&!completed&!cancelled&!blocked&.fields=entity.eid,doc.title`,
  )
  for (let task of tasks) {
    let waiting = await host.graph.read(
      `(.requires|.contains)&.edge.from=${task.entity.eid}&.edge.to.task&!edge.to.completed&!edge.to.cancelled&.fields=entity.eid&.limit=1`,
    )
    if (waiting.length) continue
    let final = step.added.findLast((b) => b.ask)?.entity.eid ??
      step.added.at(-1)?.entity.eid
    if (!final) continue
    await host.report?.(
      new Error(
        `Native session settled with unfinished claimed work: ${
          String((task.doc as Comp | undefined)?.title ?? task.entity.eid)
        }`,
      ),
      {
        eid: derivedEid(
          `native-unfinished|${session}|${task.entity.eid}|${final}`,
        ),
        during: { session, entity: task.entity.eid },
        tags: { step: final, condition: 'settled-unfinished' },
      },
    )
  }
}
