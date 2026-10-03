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
import { caught, type Sink } from '@yaks/tracker/report'
import { runs } from '@yaks/tracker/tools'
import { absent, and, eq, every, limit, parse } from '@yaks/query'

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
      for (let n = 0; n < 4; n++) await fx.work(g, AbortSignal.abort())
    },
    bugs: (app?: string) => read(app),
    unseen: (app?: string) => read(app, '.bug.status=open !notified'),
    mark,
    deployed: async (app: string) => {
      let bugs = await g.read(
        and(eq('bug.app', app), absent('resolved'), every()),
      )
      if (bugs.length) {
        await g.apply(
          bugs.map((bug) => ({
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
