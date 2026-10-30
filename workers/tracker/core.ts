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
import { survivor } from '@yaks/tracker/merge'
import { type Explanation, resolutions } from '@yaks/tracker/resolution'
import {
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
/** Where a store keeps a few facts of its own beside the graph (@yaks/sqlite
 * `meta`): the tracker keeps its bugs' tag there. */
export type Kept = {
  get: (k: string) => string | undefined
  set: (k: string, v: string) => void
}
export type Config = Options & {
  sink: Sink
  sender?: Sender
  report?: (error: unknown) => void | Promise<void>
  /** where the bugs' tag is kept, so the instance a Durable Object wakes as
   * after hibernating answers a reader as the one before did; without it,
   * the tag lives as long as the store */
  kept?: Kept
}
// What a reader of the bugs needs to read again: a commit that writes
// anything beyond the effect pool's and the scheduler's bookkeeping, where a
// finished run's delete says what it was by its guard (`$was`). Each such
// commit moves the store's tag in its own transaction, and the bugs door
// answers a reader that sends the tag it holds with 304, reading only the
// tag (door.ts). The tag is `era.count`; an era begins where no count was
// kept before.
//
// Beside the tag the store keeps the moves: the entities each such commit
// wrote, under the count it moved the tag to, so a reader holding an older
// tag of this era is told which to read again instead of reading every bug
// (door.ts `since`). An occurrence, and what came with it, moves its bug,
// whose counts it changes. The moves keep the latest `MOVES` entities; a tag
// from before the oldest they dropped is answered whole.
// The tool that writes each mark a door asks for but a fixer's.
let tools = {
  resolved: 'bug_resolve',
  archived: 'bug_archive',
  reopened: 'bug_reopen',
} as const
let STAMPS = new Set(['entity', 'created', 'updated'])
let BOOKKEEPING = new Set(['effect', 'lease', 'worker', 'wake', 'fired'])
let TAG = 'bugs-tag', MOVED = 'bugs-moved', MOVES = 1000
let only = (names: string[]) =>
  names.length > 0 && names.every((k) => BOOKKEEPING.has(k))
// A trace is read through its own doors (`traces`, `trace`), never the bugs'.
let TRACED = ['trace', 'span']
let news = (b: Bundle) =>
  b.$delete
    ? !only(Object.keys(b.$was ?? {}))
    : !TRACED.some((k) => k in b) && !Object.keys(b).every((k) =>
      STAMPS.has(k) || k[0] == '$' || BOOKKEEPING.has(k)
    )
let OCCURRENCE = ['error', 'exception', 'during', 'breadcrumbs', 'request']
let moving = (b: Bundle): string | undefined => {
  if (b.bug || !OCCURRENCE.some((k) => k in b)) return b.entity.eid
  let bug = (b.error as Comp | undefined)?.bug
  return typeof bug == 'string' ? bug : undefined
}

/** The entities moved in an era, each with the count of its latest move,
 * oldest first; nothing that moved after `floor` has been dropped. */
export type Moves = { era: string; floor: number; moves: [string, number][] }

/** The moves once the commit counted `n` moved `eids`, keeping the `most`
 * latest; the floor rises to the latest count it drops.
 *
 * ```ts
 * import { moved } from './core.ts'
 * import { equal } from '@yaks/testing'
 * let one = moved({ era: 'a', floor: 0, moves: [['x', 1], ['y', 2]] }, 3, ['x'])
 * equal(one.moves, [['y', 2], ['x', 3]])
 * equal(moved(one, 4, ['z'], 2), { era: 'a', floor: 2, moves: [['x', 3], ['z', 4]] })
 * ```
 */
export let moved = (
  log: Moves,
  n: number,
  eids: string[],
  most = MOVES,
): Moves => {
  let now = new Set(eids)
  let moves = [
    ...log.moves.filter(([eid]) => !now.has(eid)),
    ...[...now].map((eid): [string, number] => [eid, n]),
  ]
  let gone = moves.splice(0, Math.max(0, moves.length - most))
  return { ...log, floor: Math.max(log.floor, gone.at(-1)?.[1] ?? 0), moves }
}

/** What moved after count `m`, or undefined when the moves no longer reach
 * back that far.
 *
 * ```ts
 * import { since } from './core.ts'
 * import { equal } from '@yaks/testing'
 * let log = { era: 'a', floor: 2, moves: [['x', 3], ['z', 4]] as [string, number][] }
 * equal([since(log, 3), since(log, 4), since(log, 1)], [['z'], [], undefined])
 * ```
 */
export let since = (log: Moves, m: number): string[] | undefined =>
  m < log.floor ? undefined : log.moves.filter(([, n]) => n > m).map(([e]) => e)

let era = () => crypto.randomUUID().slice(0, 8)
let memory = (): Kept => {
  let held = new Map([[TAG, `${era()}.0`]])
  return { get: (k) => held.get(k), set: (k, v) => void held.set(k, v) }
}
// A tag's era and count, as the store keeps it or a reader sends it back
// (quoted, and marked weak once Cloudflare compressed the answer).
let counted = (tag?: string): [string, number] | undefined => {
  let [at, n] = tag?.replace(/^W\//, '').replaceAll('"', '').split('.') ?? []
  return at && Number.isSafeInteger(Number(n)) ? [at, Number(n)] : undefined
}
let tagging = (kept: Kept = memory()) => {
  // The era's moves; a store that kept none of them knows none before `n`.
  let log = (at: string, n: number): Moves => {
    let held: Moves | undefined
    try {
      held = JSON.parse(kept.get(MOVED) ?? 'null') ?? undefined
    } catch { /* kept by no release that wrote this shape */ }
    return held?.era == at && Array.isArray(held.moves)
      ? held
      : { era: at, floor: n, moves: [] }
  }
  let plugin: Plugin = {
    name: '@yaks/tracker/tag',
    hooks: {
      commit: (bundles) => {
        let some = bundles.filter(news)
        if (some.length) {
          let [at, n] = counted(kept.get(TAG)) ?? [era(), 0]
          kept.set(TAG, `${at}.${n + 1}`)
          let eids = some.map(moving).filter((e): e is string => !!e)
          if (eids.length) {
            kept.set(MOVED, JSON.stringify(moved(log(at, n), n + 1, eids)))
          }
        }
        return bundles
      },
    },
  }
  return {
    plugin,
    tag: () => `"${kept.get(TAG) ?? '0'}"`,
    since: (tag: string) => {
      let [at, n] = counted(kept.get(TAG)) ?? []
      let held = counted(tag)
      return at && held?.[0] == at ? since(log(at, n!), held[1]) : undefined
    },
  }
}

export let store = (storage: Storage, config: Config) => {
  let tags = tagging(config.kept)
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
  // a fixer took it for. A reopening says nothing: it takes a resolution back.
  let mark = async (
    bug: string,
    name: 'resolved' | 'archived' | 'taken' | 'reopened',
    said: Partial<Explanation> & { task?: string } = {},
  ): Promise<void> => {
    // A fixer's mark has no tool: only heal writes it, through this door.
    if (name == 'taken') {
      let row = await survivor(g, bug)
      if (!row?.bug) throw new CallError('bug', `not a bug: ${bug}`)
      return void await g.apply([{
        entity: { eid: row.entity.eid },
        taken: said.task ? { task: said.task } : {},
      }], { trusted: true })
    }
    let call: Bundle = {
      entity: { eid: crypto.randomUUID() },
      call: { args: { ...said, bug } },
    }
    let patch = await runs()[tools[name]](call, g)
    await g.apply(patch, { trusted: true })
  }
  return {
    graph: g,
    /** The bugs' tag: it moves with every commit a reader may need to see. */
    tag: tags.tag,
    /** The entities that moved since a tag of this store, the latest last,
     * or undefined when the store no longer knows. */
    since: tags.since,
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
  }
}
export type TrackerStore = ReturnType<typeof store>
