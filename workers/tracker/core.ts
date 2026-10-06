// Tracker stores compose the portable graph and downstream effect pool. Intake
// preserves reporter eids; bounded passes leave unfinished effects recoverable.

import { type Bundle, derivedEid, graph, type Storage } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { toolsDoc } from '@yaks/tools/vocab'
import { apiDoc } from '@yaks/api/vocab'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail/vocab'
import { type Sender, sending } from '@yaks/mail'
import { tick, wakeDoc } from '@yaks/wake'
import { effectDoc, effects } from '@yaks/effects'
import { computed, derived, trackerDoc } from '@yaks/tracker/vocab'
import { effects as handlers, type Options } from '@yaks/tracker/effects'
import { ingest } from '@yaks/tracker/intake'
import { timingDoc } from '@yaks/timing/vocab'
import { caught, type Sink } from '@yaks/tracker/report'
import { runs } from '@yaks/tracker/tools'
import {
  absent,
  after,
  and,
  eq,
  every,
  limit,
  order,
  parse,
  present,
} from '@yaks/query'

export let platform = derivedEid('tracker|platform')
export let vocab = loadVocab([
  kernelDoc,
  toolsDoc,
  apiDoc,
  docDoc,
  mailDoc,
  wakeDoc,
  effectDoc,
  trackerDoc,
  timingDoc,
], [kernelKeywords])
export let options = { computed, derived: derived(), number: true }
export type Config = Options & { sink: Sink; sender?: Sender }
export let store = (storage: Storage, config: Config) => {
  let fx = effects(vocab, {
    defer: true,
    max: 4,
    write: (rows) => g.apply(rows, { trusted: true }),
    report: (error) => {
      void caught(error, { sink: config.sink })
    },
  })
  let g = graph({ vocab, storage, plugins: [fx] })
  fx.handle({
    ...handlers({ graph: g }, config),
    ...config.sender ? { mail_post: sending({ sender: config.sender }) } : {},
  })
  let read = (app?: string, query = '.bug', count = 50) =>
    g.read(
      and(
        parse(query),
        ...app ? [eq('bug.app', app)] : [],
        every(),
        limit(Math.min(Math.max(count, 1), 100)),
      ),
    )
  let mark = async (bug: string, name: 'resolved' | 'archived') => {
    let call: Bundle = {
      entity: { eid: crypto.randomUUID() },
      call: { args: { bug } },
    }
    let patch = await runs()
      [`bug_${name == 'resolved' ? 'resolve' : 'archive'}`](call, g)
    await g.apply(patch, { trusted: true })
  }
  return {
    graph: g,
    ingest: (rows: Bundle[]) => ingest(g, rows),
    // One aborted pool pass claims a bounded window. Several passes let
    // grouping's newly owed notifications finish in this wake too.
    drain: async () => {
      await tick(g)
      await fx.work(g, AbortSignal.abort(), 4)
    },
    // Trace reads are bounded separately from intake; a large capture is read
    // as pages of span entities, preserving each metric component unchanged.
    traces: async (app?: string, count = 50, cursor?: string) => {
      let n = Math.min(Math.max(count, 1), 100)
      let rows = await g.read(and(
        present('trace'),
        ...app ? [eq('during.app', app)] : [],
        every(),
        order('-trace.at'),
        ...cursor ? [after(cursor)] : [],
        limit(n + 1),
      ))
      return {
        rows: rows.slice(0, n),
        ...rows.length > n ? { next: rows[n - 1].entity.eid } : {},
      }
    },
    trace: async (eid: string, count = 100, cursor?: string) => {
      let [trace] = await g.get([eid])
      if (!trace?.trace) return undefined
      let n = Math.min(Math.max(count, 1), 100)
      let spans = await g.read(and(
        eq('span.trace', eid),
        every(),
        order('entity.eid'),
        ...cursor ? [after(cursor)] : [],
        limit(n + 1),
      ))
      return {
        trace,
        spans: spans.slice(0, n),
        ...spans.length > n ? { next: spans[n - 1].entity.eid } : {},
      }
    },
    bugs: (app?: string) => read(app),
    unseen: (app?: string) => read(app, '.bug.status=open !notified'),
    mark,
    deployed: async (app: string, version?: number) => {
      let bugs = await g.read(
        and(eq('bug.app', app), absent('resolved'), every()),
      )
      let old: Bundle[] = []
      for (let bug of bugs) {
        let [current] = version == null ? [] : await g.read(and(
          eq('error.bug', bug.entity.eid),
          eq('error.version', version),
          limit(1),
        ))
        if (!current) old.push(bug)
      }
      if (old.length) {
        await g.apply(
          old.map((bug) => ({
            entity: bug.entity,
            resolved: {},
          })),
          { trusted: true },
        )
      }
    },
  }
}
export type TrackerStore = ReturnType<typeof store>
