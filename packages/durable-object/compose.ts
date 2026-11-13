/**
 * An object's graph, composed from a named config through @yaks/host: what
 * one kind of object holds is data (its config, the roles it serves, and where
 * its plugins' facets load from), so two kinds that differ only by their
 * plugins are the one class given two configs.
 *
 * - {@link planned} imports the facets a config's roles serve once an
 *   isolate (@yaks/host `prepare`), and assembles them once a vocabulary
 *   (`assemble`): every instance of a kind shares its plan, and binds it to
 *   its own storage.
 * - {@link lent} is what an object lends what it composes. It hosts no
 *   process, so nothing it composes runs a duty, ends a process or keeps a
 *   secret past the instance.
 * - {@link composed} is the whole {@link Spec}: the graph over the object's
 *   SQLite (`./store.ts`) with its blobs beside it, `api({graph, subs})` as
 *   its door and `/ws` as its sockets, and its wakes and effects pool as the
 *   works its alarm runs (`./alarm.ts`).
 *
 * ```ts
 * import { Durable } from '@yaks/durable-object/object'
 * import { composed } from '@yaks/durable-object/compose'
 * import { durable } from './testing.ts'
 * import { assertEquals } from '@std/assert'
 *
 * let config = { plugins: ['shelf'] }
 * let load = () =>
 *   Promise.resolve({
 *     docs: [{
 *       $defs: {
 *         book: { component: true, properties: { title: { type: 'string' } } },
 *       },
 *     }],
 *   })
 * let ctx = { storage: durable(), acceptWebSocket() {}, getWebSockets: () => [] }
 * let shelf = new Durable(ctx, composed(config, load))
 * await shelf.fetch(
 *   new Request('https://do/apply', {
 *     method: 'POST',
 *     body: JSON.stringify([{ entity: { eid: 'b' }, book: { title: 'Dune' } }]),
 *   }),
 * )
 * let read = await shelf.fetch(new Request('https://do/query?q=.book'))
 * assertEquals((await read.json())[0].book, { title: 'Dune' })
 * ```
 *
 * @module
 */

import type { Host, Load, Role } from '@yaks/host'
import type { Config } from '@yaks/host/config'
import type { Words } from '@yaks/host/words'
import {
  assemble,
  type Assembly,
  type Binding,
  prepare,
} from '@yaks/host/assembly'
import { effects } from '@yaks/effects'
import { type Blobs, blobSchema, sqliteBlobs } from '@yaks/blob'
import { ramVault } from '@yaks/secrets/vault'
import { statements } from '@yaks/sqlite'
import { soonest, tick } from '@yaks/wake'
import { driver } from './sql.ts'
import { storage } from './store.ts'
import type { Durable, Spec } from './object.ts'

/** A kind's plan, once its facets are imported: its assembly under `words`,
 * made once a vocabulary, or under the words its facets declare. */
export type Assembling = (words?: Words) => Assembly

/** What one kind of object composes: its facets, imported when first
 * asked. */
export type Kind = () => Promise<Assembling>

/** What an object serves unless its config says otherwise: its graph, and
 * the effects its alarm works. */
export let ROLES: readonly Role[] = ['graph', 'effects']

// Plans by config, load and roles: a kind is planned once an isolate, by
// whichever of its instances asks first.
let plans = new WeakMap<Config, WeakMap<Load, Map<string, Kind>>>()

/** The plan for `config`'s `roles`, with facets from `load`, made once an
 * isolate. One whose import failed is imported again by the next to ask. */
export let planned = (
  config: Config,
  load: Load,
  roles: readonly Role[] = ROLES,
): Kind => {
  let byLoad = plans.get(config)
  if (!byLoad) plans.set(config, byLoad = new WeakMap())
  let byRoles = byLoad.get(load)
  if (!byRoles) byLoad.set(load, byRoles = new Map())
  let key = roles.join(), plan = byRoles.get(key)
  if (plan) return plan
  let made: Promise<Assembling> | undefined
  plan = () =>
    made ??= prepare(config, roles, load).then((facets) => {
      let own: Assembly | undefined
      let worded = new WeakMap<Words, Assembly>()
      let assembly = (words?: Words) =>
        assemble(config, roles, load, facets, words ? { words } : {})
      return (words?: Words) => {
        if (!words) return own ??= assembly()
        let held = worded.get(words)
        if (!held) worded.set(words, held = assembly(words))
        return held
      }
    }, (e) => {
      made = undefined
      throw e
    })
  byRoles.set(key, plan)
  return plan
}

/** What an object lends the plugins it composes, as `me`, its bodies kept in
 * `blobs`. */
export let lent = (me: string, blobs: Blobs): Binding['host'] => ({
  me,
  vault: ramVault(),
  blobs,
  artifacts: blobs,
  stopping: new AbortController().signal,
  duties: () => Promise.resolve(),
  end: () => Promise.resolve(),
  bury: () => Promise.resolve([]),
  gone: () => Promise.resolve(false),
})

/** How {@link composed} composes. */
export type Composing = {
  /** The roles served ({@link ROLES} by default). */
  roles?: readonly Role[]
  /** The words the graph speaks, where the object knows them before its
   * facets do. */
  words?: Words
  /** A failure the object caught, by its entry (the console by default). */
  report?: Spec['report']
  /** The deploy the object runs (`Spec.version`). */
  version?: string
}

/**
 * The spec of an object composed from `config`, with facets from `load`: its
 * graph over the object's SQLite, schema and blobs installed as it opens; its
 * door `api({graph, subs, db})`, which keeps its receipts in the object's
 * SQLite and hands `/ws` to its sockets; and as its
 * works, the wakes due (@yaks/wake `tick`) and the effects pool, each
 * answering when it is next owed. A write that moves a wake or owes a run arms
 * the alarm.
 */
export let composed = (
  config: Config,
  load: Load,
  options: Composing = {},
): Spec => {
  let plan = planned(config, load, options.roles)
  let report = options.report ??
    ((error: unknown, entry: string) => console.error(entry, error))
  return {
    report,
    ...options.version ? { version: options.version } : {},
    open: async (object) => {
      let assembly = (await plan())(options.words)
      let { host } = bound(object, assembly, report)
      let g = host.graph, fx = host.fx
      // The door, loaded only by an object that opens one.
      let { api, subscriptions } = await import('@yaks/api')
      let subs = subscriptions(g)
      let door = api({ graph: g, subs, db: host.storage.statements })
      let wakes = !!host.vocab.comp('wake'), runs = !!host.vocab.comp('effect')
      return {
        serve: (request) =>
          new URL(request.url).pathname == '/ws'
            ? object.accept(request)
            : door(request),
        subs,
        works: {
          ...wakes
            ? {
              wakes: async () => {
                let now = Date.now()
                for (let { error } of (await tick(g, now)).refused) {
                  report(error, 'alarm wakes')
                }
                return await soonest(g, now)
              },
            }
            : {},
          ...runs
            ? {
              effects: async (until: number) => {
                await fx.work(g, undefined, { until })
                await fx.idle()
                return await fx.next(g)
              },
            }
            : {},
        },
      }
    },
  }
}

// `assembly` bound inside `object`: its storage, its blobs and its pool.
let bound = (object: Durable, assembly: Assembly, report: Spec['report']) => {
  let { ctx } = object
  let sql = driver(ctx.storage)
  let store: ReturnType<typeof storage> | undefined
  let arm = (at: number) =>
    void object.clock.arm(at).catch((e) => report(e, 'arm'))
  let made = assembly.bind({
    host: lent(ctx.id?.name ?? 'object', sqliteBlobs(statements(sql))),
    storage: (host: Host, extend) =>
      store = storage(ctx.storage, host.vocab, {
        derived: host.derived,
        extend,
      }),
    schema: (_host, stmts) => {
      for (let stmt of blobSchema()) sql.query(stmt)
      store!.install()
      for (let stmt of stmts) sql.query(stmt)
    },
    effects: (host, disabled) =>
      effects(host.vocab, {
        disabled,
        singleOwner: true,
        defer: true,
        // How a run ended is written while the object is stopped too, so a
        // run that finished never runs again (`./ceiling.ts`).
        free: (write) => object.ceiling.free(write),
        nudge: () => arm(Date.now()),
        report: (error, { handler }) => report(error, `effect ${handler}`),
      }),
  })
  if (made.host.vocab.comp('wake')) {
    let at = (e: { comp?: { at?: unknown } }) => {
      let when = Date.parse(String(e.comp?.at ?? ''))
      if (Number.isFinite(when)) arm(when)
    }
    made.host.fx.on('wake', {
      doc: 'arm the object for the wake a write just moved',
      created: at,
      changed: { at },
    })
  }
  return made
}
