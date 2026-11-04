import { durable } from './store-state-probe.ts'
export { durable } from './store-state-probe.ts'
import { bindings, kvStorage } from './binding-probe.ts'
export {
  analytics,
  assets,
  bucket,
  cards,
  dataset,
  emailed,
  kv,
  kvStorage,
  limiter,
} from './binding-probe.ts'
export { type Ran, sandboxes, workspaces } from './workspace-probe.ts'
export { ai, embeds, modelPage, type Turn } from './model-probe.ts'
export { app, declared, owned, space } from './directory-fixture.ts'
// The platform in memory: the kernel's own bindings, stood up under Deno so a
// test can drive the code that runs in production with nothing stubbed between
// a request and the rows.
//
// It is a file rather than a helper inside one test because two suites need
// it — serving_test.ts, which serves an app off it, and builder_test.ts, which
// builds one on it — and a second copy of a Store namespace is a second answer
// to what a Store namespace is.
//
// What is here is only what the runtime gives a Worker and Deno does not: the
// streaming HTML rewriter, a Durable Object's state (the stand-in
// @yaks/durable-object ships), an R2 bucket, a scripted Workers AI binding,
// and the namespace that hands out a Store per name. Everything above them —
// the directory, the tools, the serving door — is the kernel's own code,
// called directly.
import { driver, type DurableStorage, type Wire } from '@yaks/durable-object'
import {
  among,
  by,
  col,
  type Expr,
  type Insert,
  lit,
  type Param,
  scan,
  type Select,
  select,
  table,
  type Update,
  val,
} from '@yaks/sql'
import { objects } from '@yaks/sqlite'
import { durable as raw } from '../../packages/durable-object/testing.ts'
import { dropDdl } from '@yaks/journal'
import { builders } from './builder-probe.ts'
import type { Load } from '@yaks/host'
import { cleanup } from '@yaks/testing'
import type { Env } from './env.ts'
import { Store } from './graph.ts'
import { PLATFORM_OBJECT, PLATFORM_STORE } from './door.ts'

/**
 * Point-in-time recovery, faked (recover.ts, T-34507).
 *
 * There is nowhere at all to drive a restore against a runtime: local workerd
 * answers `getCurrentBookmark` and refuses the other two — "This Durable
 * Object's storage back-end does not implement point-in-time recovery" —
 * so the probe kernel (probe.ts) cannot hold this gesture either. What is
 * imitated here is the contract and not the recovery: a bookmark that moves
 * with every read, a bookmark for a moment inside the window and a throw
 * outside it, and the restore remembered rather than performed.
 *
 * That is enough for the half that is ours — the order the record is written
 * in, the sentence that comes back, the restart being asked for — and it
 * proves nothing whatever about SQLite going backwards, which is Cloudflare's
 * half and is not ours to test.
 */
export type Pitr = {
  /** The bookmark the object was last told to wake at, if it was told one. */
  restore: string
  /** How many times a restart was asked for. */
  aborts: number
  /** Every bookmark handed out, in order. */
  marks: string[]
}

/** One Durable Object's state, as the Store constructor takes it. */
export let state = (name = '', prepared = true) => {
  let live: Wire[] = []
  let pending = new Set<Promise<unknown>>()
  let pitr: Pitr = { restore: '', aborts: 0, marks: [] }
  let bookmark = (name: string) => {
    pitr.marks.push(name)
    return Promise.resolve(name)
  }
  return {
    pending,
    waitUntil: (work: Promise<unknown>) => {
      pending.add(work)
      work.then(() => pending.delete(work), () => pending.delete(work))
    },
    storage: Object.assign(prepared ? durable(name) : raw(), kvStorage(), {
      getCurrentBookmark: () => bookmark(`at-${pitr.marks.length}`),
      getBookmarkForTime: (at: number | Date) => {
        let t = at instanceof Date ? at.getTime() : at
        if (Date.now() - t > 30 * 24 * 60 * 60_000) {
          return Promise.reject(
            new Error('the bookmark is outside the 30-day window'),
          )
        }
        return bookmark(`at-${new Date(t).toISOString()}`)
      },
      onNextSessionRestoreBookmark: (b: string) => {
        pitr.restore = b
        return Promise.resolve(`undo-${b}`)
      },
    }),
    live,
    pitr,
    abort: () => void pitr.aborts++,
    acceptWebSocket: (ws: Wire) => void live.push(ws),
    getWebSockets: () => live,
  }
}

// ---- an object's own rows, as older code left them ----

type Fields = Record<string, Param | Expr>
let expr = (v: Param | Expr): Expr =>
  v && typeof v == 'object' && 't' in v ? v : val(v)

/** Every row of a table, set. */
export let every = (name: string, set: Fields): Update => ({
  t: 'update',
  table: name,
  set: Object.fromEntries(Object.entries(set).map(([k, v]) => [k, expr(v)])),
})

/** A slot of the object's key-value memory (graph.ts `#get` and `#put`),
 * read, and set. */
let slotOf = (k: string): Select =>
  select({ cols: [col('v')], from: table('yak_kv'), where: by({ k }) })
let slotted = (k: string, v: string): Insert => ({
  t: 'insert',
  into: 'yak_kv',
  cols: ['k', 'v'],
  rows: [[val(k), val(v)]],
  upsert: [{ on: [col('k')], set: { v: col('v', 'excluded') } }],
})

/** Anything holding an object's storage: its state, as a test keeps it. */
type Held = { storage: DurableStorage }

/** The object's SQLite, the way the store reaches it. */
export let db = ({ storage }: Held) => driver(storage)

/** The names of what the object's schema holds: tables, indexes, triggers. */
export let named = (held: Held, fields: Record<string, Param>) =>
  objects(db(held), fields).map((r) => String(r.name))

export let slot = (held: Held, k: string): string | null =>
  (db(held).query(slotOf(k))[0]?.v as string | undefined) ?? null
export let keep = (held: Held, k: string, v: string) =>
  db(held).query(slotted(k, v))

/**
 * A store as it stood before archetypes: its rows unclassified, no descriptor
 * and none of their tables, and a schema stamp the next wake moves, so that
 * wake backfills.
 */
export let unclassified = (held: Held, stamp: string) => {
  let d = db(held)
  d.query({ t: 'update', table: 'entity', set: { archetype: lit(null) } })
  // A pre-archetype store predates the journal as well; remove its
  // append-only references before deleting descriptor spine rows.
  for (let stmt of dropDdl()) d.query(stmt)
  let descriptors = scan(d, 'archetype', undefined, ['entity'])
    .map((r) => val(Number(r.entity)))
  for (let name of ['retired', 'archetype']) {
    d.query({ t: 'drop', kind: 'table', name })
  }
  d.query({ t: 'delete', from: 'entity', where: among(col('id'), descriptors) })
  keep(held, 'schema', stamp)
}

/**
 * One platform: a Store per name the kernel builds, the bucket its files are
 * in, and the platform's own assets off disk (the client an app imports, the
 * guide the builder reads). Made in a test, it closes as the test ends, inside
 * the test's time, so what it left running never reaches the next test.
 */
export let platform = (
  secret: string,
  vars: Partial<Env> = {},
  load?: Load,
) => {
  let p = lasting(secret, vars, load)
  cleanup(p[Symbol.asyncDispose])
  return p
}

/** A platform that lasts until its holder closes it, as the kernel a test
 * process shares does (probe.ts). */
export let lasting = (
  secret: string,
  vars: Partial<Env> = {},
  load?: Load,
) => {
  let stores: ReturnType<typeof state>[] = []
  let ownedState = (name?: string) => {
    let ctx = state(name ?? '', name !== undefined)
    stores.push(ctx)
    return ctx
  }
  let objects = new Map<string, Store>()
  let initialized: Promise<Response> | undefined
  let sockets = new Map<string, Wire[]>()
  // What the runtime did to each object, beside what the object did: the
  // restore it was told to wake at and the restart it was asked for, which
  // are the runtime's half of a recovery and not the Store's (recover.ts).
  let recovery = new Map<string, Pitr>()
  // Each object's own state, by name: its sockets, its recovery, and the one
  // alarm it arms for the wakes it holds (graph.ts, D-37562). A test reads the
  // instant back off it, which is what the runtime would deliver.
  let states = new Map<string, ReturnType<typeof state>>()
  // The runtime indexes armed alarms. Idle objects need no storage read on
  // every clock tick, even when a shared kernel has opened many of them.
  let armed = new Set<string>()
  // Each armed object's own alarm, by the name its state is kept under.
  let alarms = new Map<string, () => Promise<void>>()
  // An object's state whose alarm the runtime delivers: arming it indexes
  // the object, and `alarm` is what a delivery calls.
  let alarmed = (
    name: string,
    ctx: ReturnType<typeof state>,
    alarm: () => Promise<void>,
  ) => {
    let setAlarm = ctx.storage.setAlarm.bind(ctx.storage)
    let deleteAlarm = ctx.storage.deleteAlarm.bind(ctx.storage)
    ctx.storage.setAlarm = async (...args) => {
      await setAlarm(...args)
      armed.add(name)
    }
    ctx.storage.deleteAlarm = async () => {
      await deleteAlarm()
      armed.delete(name)
    }
    states.set(name, ctx)
    alarms.set(name, alarm)
  }
  let object = (name: string) => {
    let held = objects.get(name)
    if (!held) {
      let ctx = Object.assign(ownedState(name), {
        id: { toString: () => name },
      })
      alarmed(name, ctx, () => object(name).alarm())
      sockets.set(name, ctx.live)
      recovery.set(name, ctx.pitr)
      objects.set(name, held = new Store(ctx, env, undefined, undefined, load))
    }
    return held
  }
  // The builder's object, one per space (build.ts). Made on demand like a
  // store, and kept, so a second connection reaches the conversation the first
  // one started. Its alarm runs the Operator's effects, delivered like a
  // store's.
  let { builder, namespace } = builders(() => env, (name) => {
    let ctx = ownedState()
    alarmed(`builder ${name}`, ctx, () => builder(name).alarm())
    sockets.set(`builder ${name}`, ctx.live)
    return ctx
  })
  let { env, files } = bindings(secret, {
    STORE: {
      idFromName: (n: string) => n,
      get: (n: unknown) => ({
        fetch: async (r: Request) => {
          let store = object(String(n))
          // The deployed directory carries the platform's shipped integrations
          // and wakes. The fixture supplies that deployment once, before reads.
          if (String(n) == PLATFORM_OBJECT) {
            initialized ??= store.fetch(
              new Request('http://store/vocab', {
                method: 'POST',
                headers: { 'x-store': PLATFORM_STORE, 'x-yak-kernel': '1' },
                body: '{}',
              }),
            )
            let deployed = await initialized
            if (!deployed.ok) throw Error('fixture directory deployment failed')
          }
          return store.fetch(r)
        },
      }),
    },
    BUILDER: namespace,
    ...vars,
  })
  // Every alarm that is due, delivered the way the runtime delivers one: the
  // instant cleared, then the object's `alarm()`, which may arm the next.
  // Each object's delivery is its own, as in the runtime: an object is never
  // delivered to twice at once, and one whose alarm is still running holds
  // back no other object's. A test drives this by hand; a kernel (probe.ts)
  // on a timer, shared by every test in the process.
  let ringing = new Map<string, Promise<void>>()
  let deliver = (name: string) => {
    let ctx = states.get(name)!
    let delivery = (async () => {
      let at = await ctx.storage.getAlarm()
      if (at == null || at > Date.now()) return
      await ctx.storage.deleteAlarm()
      await alarms.get(name)!()
    })().finally(() => ringing.delete(name))
    ringing.set(name, delivery)
    return delivery
  }
  let ring = async (): Promise<void> => {
    if (closing) return
    await Promise.all(
      [...armed].filter((name) => !ringing.has(name)).map(deliver),
    )
  }
  // Every store's waitUntil work, and the alarm deliveries under way: what a
  // write leaves running after it answers, such as the effects it owed.
  let pending = () => [
    ...ringing.values(),
    ...stores.flatMap((ctx) => [...ctx.pending]),
  ]
  // Until nothing is left running, including work that work started.
  let settled = async () => {
    for (let work = pending(); work.length; work = pending()) {
      await Promise.allSettled(work)
    }
  }
  let closing: Promise<void> | null = null
  let close = () => {
    if (closing) return closing
    let release = () => {
      for (let ctx of stores) ctx.storage[Symbol.dispose]()
      stores.length = 0
    }
    // A Durable Object's runtime retains its storage for waitUntil work.
    // An alarm delivery can start such work or call another store before it
    // settles, so closing waits through the active delivery as well.
    if (!pending().length) {
      release()
      return closing = Promise.resolve()
    }
    return closing = (async () => {
      await settled()
      release()
    })()
  }
  return {
    env,
    files,
    object,
    states,
    sockets,
    builder,
    recovery,
    ring,
    settled,
    [Symbol.asyncDispose]: close,
  }
}
