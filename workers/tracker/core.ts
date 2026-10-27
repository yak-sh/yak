// Tracker stores compose the portable graph and downstream effect pool. Intake
// preserves reporter eids; bounded passes leave unfinished effects recoverable.

import type { Bundle, Comp, Plugin, Storage } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { CallError } from '@yaks/tools/errors'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
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
import { caught, origin, type Sink } from '@yaks/tracker/report'
import { bug, bugs, runs } from '@yaks/tracker/tools'
import { type Explanation, resolutions } from '@yaks/tracker/resolution'
import {
  absent,
  after,
  and,
  conjoin,
  eq,
  every,
  fields,
  limit,
  list,
  order,
  parse,
  present,
} from '@yaks/query'

export let platform = derivedEid('tracker|platform')
export let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
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
export type Config = Options & {
  sink: Sink
  sender?: Sender
  report?: (error: unknown) => void | Promise<void>
}
// What a reader of the bugs needs to read again: a commit that writes
// anything beyond the effect pool's and the scheduler's bookkeeping. Each one
// moves the store's tag, and the bugs door answers a reader that sends the
// tag it holds with 304 and no row read (door.ts). A store's tag starts fresh
// with each instance, so a reader of the one before is answered in full.
let STAMPS = new Set(['entity', 'created', 'updated'])
let BOOKKEEPING = new Set(['effect', 'lease', 'worker', 'wake', 'fired'])
let tagging = () => {
  let born = crypto.randomUUID().slice(0, 8), moved = 0
  // The bookkeeping rows written since this instance began. A delete names
  // only its eid, so a finished run's delete moves nothing only when its row
  // is one of these; a row from before is read again once.
  let kept = new Set<string>()
  let moves = (b: Bundle) => {
    let eid = b.entity.eid
    if (b.$delete) return !kept.delete(eid)
    let keys = Object.keys(b).filter((k) => !STAMPS.has(k) && k[0] != '$')
    if (!keys.every((k) => BOOKKEEPING.has(k))) return kept.delete(eid), true
    if (keys.length) kept.add(eid)
    return false
  }
  let plugin: Plugin = {
    name: '@yaks/tracker/tag',
    hooks: {
      effect: (bundles) => {
        if (bundles.map(moves).includes(true)) moved++
        return bundles
      },
    },
  }
  return { plugin, tag: () => `"${born}.${moved}"` }
}

export let store = (storage: Storage, config: Config) => {
  let tags = tagging()
  let fx = effects(vocab, {
    singleOwner: true,
    defer: true,
    max: 4,
    write: (rows) => g.apply(rows, { trusted: true }),
    report: (error) => {
      if (config.report) void config.report(error)
      else {
        void caught(error, {
          sink: config.sink,
          ...origin('yak-tracker', undefined, 'Tracker.effect'),
        })
      }
    },
  })
  let g = graph({
    vocab,
    storage,
    plugins: [fx, resolutions(), tags.plugin],
  })
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
  // What a mark says beside the bug: a resolution's explanation, or the task
  // a fixer took it for.
  let mark = async (
    bug: string,
    name: 'resolved' | 'archived' | 'taken',
    said: Partial<Explanation> & { task?: string } = {},
  ): Promise<void> => {
    // A fixer's mark has no tool: only heal writes it, through this door.
    if (name == 'taken') {
      let [row] = await g.get([bug])
      if (!row?.bug) throw new CallError('bug', `not a bug: ${bug}`)
      return void await g.apply([{
        entity: { eid: bug },
        taken: said.task ? { task: said.task } : {},
      }], { trusted: true })
    }
    let call: Bundle = {
      entity: { eid: crypto.randomUUID() },
      call: { args: { ...said, bug } },
    }
    let patch = await runs()
      [`bug_${name == 'resolved' ? 'resolve' : 'archive'}`](call, g)
    await g.apply(patch, { trusted: true })
  }
  return {
    graph: g,
    /** The bugs' tag: it moves with every commit a reader may need to see. */
    tag: tags.tag,
    ingest: (rows: Bundle[]) => ingest(g, rows),
    // One aborted pool pass handles a bounded window. Several passes let
    // grouping's newly owed notifications finish in this wake too.
    drain: async (now = Date.now()) => {
      await tick(g, now)
      await fx.work(g, AbortSignal.abort(), 4)
    },
    // Published app_errors archives occurrences and stamps agent delivery,
    // separately from a bug's mail notification and resolution.
    markErrors: async (
      app: string,
      eids: string[],
      mark: 'notified' | 'archived',
    ) => {
      let found = (await g.get(eids)).filter((row) =>
        row.error && row.during &&
        (row.during as Comp).app == app
      )
      if (found.length) {
        await g.apply(
          found.map((row) => ({
            entity: row.entity,
            [mark]: {},
          })),
          { trusted: true },
        )
      }
      return found.length
    },
    // Only composed handlers can make progress. Unknown or disabled errands
    // must not keep an otherwise idle object awake.
    next: async (now = Date.now()): Promise<number | null> => {
      let names = [
        ...new Set(
          fx.slots().filter((s) => s.effect && s.run).map((s) => s.id),
        ),
      ]
      let [pending] = await g.read(and(
        eq('effect.state', 'pending'),
        eq('effect.handler', list(...names)),
        order('effect.next'),
        limit(1),
        fields('effect.next'),
      ))
      let [wake] = await g.read(
        '.wake.at>=1970-01-01T00:00:00Z .order=wake.at .limit=1 .fields=wake.at',
      )
      let at = (value: unknown) => Date.parse(String(value)) || now + 1000
      let next = Math.min(
        pending ? at((pending.effect as Comp | undefined)?.next) : Infinity,
        wake ? at((wake.wake as Comp | undefined)?.at) : Infinity,
      )
      return Number.isFinite(next) ? Math.max(now + 1000, next) : null
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
    bugs: (app?: string, query = '.bug', count = 50) =>
      bugs(g, parse(conjoin(query, app ? `.bug.app=${app}` : '')), count),
    bug: (eid: string) => bug(g, eid),
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
      // Nobody looked at why; the new version simply has not hit it.
      let release = version == null ? 'a new version' : `version ${version}`
      if (old.length) {
        await g.apply(
          old.map((bug) => ({
            entity: bug.entity,
            resolved: {
              cause:
                `Not investigated: the app deployed ${release}, and it has not happened in it.`,
              recur:
                'It can: if it happens in a version it has not happened in before, it reopens.',
            },
          })),
          { trusted: true },
        )
      }
    },
  }
}
export type TrackerStore = ReturnType<typeof store>
