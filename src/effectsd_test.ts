// The effects daemon's dispatch model (D-22388 step 3): effects leave the
// serving process for a leased journal consumer (effectsd.ts). effectsd is a
// top-level script — it takes the temporary effects lease and runs forever on
// import — so it can't be imported; what this file proves is the MODEL it is
// assembled from, at the seam, WITHOUT ever launching a real agent (every
// handler here is a stub and no `session` spawn row is committed):
//
//   1. Two catchup feeds over one journal — a server feed filtered to
//      `where:'serve'` and a daemon feed filtered to `where:'do'` — fire every
//      registered effect in EXACTLY ONE process. The partition is complementary
//      and total (`Where = 'serve' | 'do'`), so no committed effect is dropped
//      and none double-fires. This is the crux: one dispatch per committed row.
//   2. A daemon RESTART re-dispatches nothing already past its cursor. A fresh
//      catchup starts at the journal top (cursorOf = max rowid), so history is
//      never replayed — the no-double-fire half of exactly-once. The lost-effect
//      half (an intent whose effect died in the crash gap) is the boot relay's,
//      proven in effects_test.ts (`split relay`).
//   3. The temporary effects lease admits one dispatcher until durable
//      per-effect claims replace process-level election.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { apply, journalSince } from './db.ts'
import { catchup } from './catchup.ts'
import {
  commitEffects,
  configureEffects,
  dispatch,
  fed,
  on,
} from './effects.ts'
import { takeEffectsLease } from './effects_lease.ts'
import { bareDb } from './testdb.ts'
import { slow } from './testing.ts'
import type { Change } from './types.ts'
import { open } from './store/sqlite.ts'

let doc = (eid: string, title: string): Change => ({
  eid,
  name: 'doc',
  comp: { title },
})

// A pair of catchup feeds over one db, each dispatching the fed rows its
// process owns — the two-process split as effectsd + server assemble it.
let split = (db: ReturnType<typeof bareDb>) => {
  let feed = (want: (w: 'serve' | 'do') => boolean) =>
    catchup(db, (r) => {
      if (r.trace) dispatch(r.batch, r.trace, () => {}, want)
    })
  return { server: feed((w) => w == 'serve'), daemon: feed((w) => w == 'do') }
}

Deno.test('two feeds, one journal: each effect fires in exactly one process', () => {
  let db = bareDb()
  let fired: string[] = []
  // The three trigger classes the daemon owns, modelled with stubs:
  // created is the spawn/knock/mail family, changed is the stop_request signal,
  // removed is the session-delete kill. All default to 'do'.
  on('doc', {
    created: (eid) => fired.push(`do:create ${eid}`),
    changed: { body: (eid) => fired.push(`do:signal ${eid}`) },
    removed: (eid) => fired.push(`do:kill ${eid}`),
  })
  // The serve-owned sibling (the graph-native runner's rows) must fire ONLY in
  // the server, never in the daemon.
  on('doc', {
    where: 'serve',
    created: (eid) => fired.push(`serve:create ${eid}`),
  })

  let { server, daemon } = split(db)
  let eid = crypto.randomUUID()

  // create → the spawn family (do) once in the daemon, the runner row (serve)
  // once in the server; neither crosses.
  apply(db, [{ eid, name: 'entity', comp: { eid } }, doc(eid, 't')], fed())
  server.settle()
  daemon.settle()
  assertEquals(fired.toSorted(), [`do:create ${eid}`, `serve:create ${eid}`])

  // changed → the stop_request signal, do-only.
  fired.length = 0
  apply(db, [{ eid, name: 'doc', comp: { body: 'x' } }], fed())
  server.settle()
  daemon.settle()
  assertEquals(fired, [`do:signal ${eid}`])

  // removed → the session-delete kill, do-only.
  fired.length = 0
  apply(db, [{ eid, name: 'entity', comp: null }], fed())
  server.settle()
  daemon.settle()
  assertEquals(fired, [`do:kill ${eid}`])
})

Deno.test('a daemon restart re-dispatches nothing past its cursor', () => {
  let db = bareDb()
  // A live daemon has drained the journal to here.
  let live = catchup(db, () => {})
  apply(db, [doc(crypto.randomUUID(), 'a')], fed())
  apply(db, [doc(crypto.randomUUID(), 'b')], fed())
  live.settle()
  // The restart: a brand-new feed, cursor at the journal top — the boot
  // reconcile owns the gap, so history must never be handed back for dispatch.
  let handed: number[] = []
  let restarted = catchup(db, (r) => handed.push(r.rowid))
  restarted.settle()
  assertEquals(handed, [], 'a restart replays no committed row')
  // But a commit AFTER the restart is handed exactly once.
  apply(db, [doc(crypto.randomUUID(), 'c')], fed())
  restarted.settle()
  restarted.settle()
  assertEquals(handed.length, 1, 'the post-restart row, once and only once')
  assert(handed[0] == journalSince(db, 0).at(-1)!.rowid)
})

Deno.test('configured driver journals nested cross-owner effects exactly once', () => {
  let path = `${Deno.makeTempDirSync()}/split-effects.db`
  let writer = open(path)
  let serving = open(path)
  let daemon = open(path)
  // Boot writes journal rows of its own (the edge backfill over the seed's
  // dependency rows, T-23822) and they carry no trace. This test's window
  // starts after them.
  let booted = journalSince(writer, 0).at(-1)?.rowid ?? 0
  let serveCalls = 0
  let sameOwnerCalls = 0
  let serveToDoCalls = 0

  // The do-owned first hop writes one serve-owned and one do-owned
  // consequence through the configured driver.
  on('meta', {
    created: () => {
      commitEffects((t) =>
        apply(daemon, [
          { eid: crypto.randomUUID(), name: 'brief', comp: { text: 'serve' } },
          { eid: crypto.randomUUID(), name: 'doc', comp: { title: 'same' } },
        ], t), () => {})
    },
  })
  on('brief', { where: 'serve', created: () => serveCalls++ })
  on('doc', { created: () => sameOwnerCalls++ })

  // The reverse direction: a serve-owned handler writes a do-owned row.
  on('canvas', {
    where: 'serve',
    created: () => {
      commitEffects(
        (t) =>
          apply(serving, [{
            eid: crypto.randomUUID(),
            name: 'alias',
            comp: { slug: crypto.randomUUID() },
          }], t),
        () => {},
      )
    },
  })
  on('alias', { created: () => serveToDoCalls++ })

  let serveFeed = catchup(serving, (r) => {
    if (r.trace) {
      dispatch(r.batch, r.trace, () => {}, (w) => w == 'serve')
    }
  })
  let daemonFeed = catchup(daemon, (r) => {
    if (r.trace) {
      dispatch(r.batch, r.trace, () => {}, (w) => w == 'do')
    }
  })

  let restore = configureEffects({
    split: true,
    want: (w) => w == 'do',
    settle: daemonFeed.settle,
  })
  commitEffects(
    (t) =>
      apply(writer, [{
        eid: crypto.randomUUID(),
        name: 'meta',
        comp: {},
      }], t),
    () => {},
  )
  assertEquals(serveCalls, 0, 'the daemon never invokes the serve consequence')
  assertEquals(sameOwnerCalls, 1, 'same-owner nested consequence fires once')
  assert(
    journalSince(writer, booted).every((r) => r.trace),
    'root and nested births carry fed traces',
  )

  restore()
  restore = configureEffects({
    split: true,
    want: (w) => w == 'serve',
    settle: serveFeed.settle,
  })
  serveFeed.settle()
  serveFeed.settle()
  assertEquals(serveCalls, 1, 'the serving feed invokes the consequence once')
  assertEquals(sameOwnerCalls, 1, 'the serving feed cannot double-fire do work')

  commitEffects(
    (t) =>
      apply(serving, [{
        eid: crypto.randomUUID(),
        name: 'canvas',
        comp: {},
      }], t),
    () => {},
  )
  assertEquals(serveToDoCalls, 0, 'serve does not invoke its do consequence')

  restore()
  restore = configureEffects({
    split: true,
    want: (w) => w == 'do',
    settle: daemonFeed.settle,
  })
  daemonFeed.settle()
  daemonFeed.settle()
  assertEquals(serveToDoCalls, 1, 'the daemon invokes the reverse hop once')
  restore()
  writer.close()
  serving.close()
  daemon.close()
})

slow(
  'the temporary effects lease admits one dispatcher',
  async () => {
    let db = `${Deno.makeTempDirSync()}/graph.db`
    let now = () => Promise.resolve() // instant polls — prove the logic, not the wait

    // One dispatcher: the effects lease, once held, refuses a second taker.
    let held = await takeEffectsLease(db)
    try {
      let e = await assertRejects(() => takeEffectsLease(db, { rest: now }))
      assertStringIncludes((e as Error).message, 'already held')
      assertStringIncludes((e as Error).message, 'effects lease')
    } finally {
      held!.close()
    }
    // Released with the process — a successor daemon takes it next.
    let next = await takeEffectsLease(db)
    next!.close()
  },
)
