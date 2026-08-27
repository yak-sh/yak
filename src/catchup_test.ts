// The journal feed's contract (D-22388 step 1): every journaled commit is
// handed to the consumer exactly once, in rowid order — a consumer's own
// writes and a foreign connection's uniformly — and only a fed() trace asks
// the feed to dispatch effects. The polling half (foreign wake) uses a file db
// and lives in the slow tier.
import { assert, assertEquals } from '@std/assert'
import { apply, connect, journalSince, open, recast, record } from './db.ts'
import { catchup } from './catchup.ts'
import { dispatch, fed, on, trace } from './effects.ts'
import type { Change } from './types.ts'
import { bareDb } from './testdb.ts'
import { slow, until } from './testing.ts'

let doc = (title: string): Change => ({
  eid: crypto.randomUUID(),
  name: 'doc',
  comp: { title },
})

Deno.test('catchup hands each row once, in order, and never again', () => {
  let db = bareDb()
  let rows: number[] = []
  let feed = catchup(db, (r) => rows.push(r.rowid))
  apply(db, [doc('one')], fed())
  apply(db, [doc('two')], fed())
  feed.settle()
  assertEquals(rows.length, 2)
  assert(rows[0] < rows[1], 'rowid order')
  feed.settle()
  assertEquals(rows.length, 2, 'a settled row never replays')
})

Deno.test('only a fed() trace journals an effect ask', () => {
  let db = bareDb()
  let feed = catchup(db, () => {})
  let since = feed.at()
  apply(db, [doc('fed')], fed())
  apply(db, [doc('inline')], trace())
  apply(db, [doc('none')])
  record(db, [doc('stamp')])
  let rows = journalSince(db, since)
  assertEquals(rows.length, 4)
  assert(rows[0].trace, 'fed() journals the trace')
  assert(rows[0].trace!.created.has(`doc ${rows[0].batch[0].eid}`))
  assertEquals(rows[1].trace, null, 'a plain trace dispatched at its site')
  assertEquals(rows[2].trace, null, 'no trace, no effects')
  assertEquals(rows[3].trace, null, 'the stamp door never dispatches')
})

Deno.test('a consumer write re-enters without loss or repeat', () => {
  let db = bareDb()
  let seen: string[] = []
  let followed = false
  let feed = catchup(db, (r) => {
    seen.push(...r.batch.map((c) => String(c.comp?.title)))
    if (!followed) {
      followed = true
      // An effect writing back re-enters settle(): the outer drain must pick
      // this row up in the same call, once.
      apply(db, [doc('follow-up')], fed())
      feed.settle()
    }
  })
  apply(db, [doc('first')], fed())
  feed.settle()
  assertEquals(seen.filter((t) => t == 'first').length, 1)
  assertEquals(seen.filter((t) => t == 'follow-up').length, 1)
})

Deno.test('effects fire exactly once per fed row, through the feed', () => {
  let db = bareDb()
  let fired: string[] = []
  // Registered here only: this test file never imports server.ts, so the
  // global registry carries nothing else for 'doc'.
  on('doc', { created: (eid) => fired.push(eid) })
  let feed = catchup(db, (r) => {
    if (r.trace) dispatch(recast(db, r), r.trace, () => {})
  })
  let a = doc('a'), b = doc('b')
  apply(db, [a], fed())
  apply(db, [b], trace()) // dispatched at the call site — not the feed's row
  feed.settle()
  feed.settle()
  assertEquals(fired, [a.eid], 'one fed create, one dispatch, never again')
})

Deno.test('recast echoes the server-stamped fill beside the batch', () => {
  let db = bareDb()
  let feed = catchup(db, () => {})
  let since = feed.at()
  let e = doc('stamped')
  apply(db, [e, { eid: e.eid, name: 'archived', comp: {} }], fed())
  let [row] = journalSince(db, since)
  let out = recast(db, row)
  let echo = out.findLast((c) => c.name == 'archived')
  assert(echo?.comp?.at, 'the archived stamp re-reads with its fill')
  assert(
    out.some((c) => c.name == 'created' && c.eid == e.eid),
    'provenance synthesized from the envelope',
  )
})

slow('data_version bumps for a foreign commit, never our own', () => {
  let path = Deno.makeTempDirSync({ prefix: 'catchup' }) + '/g.db'
  let a = open(path)
  let b = connect(path)
  let v = (d: typeof a) =>
    (d.prepare('pragma data_version').get() as { data_version: number })
      .data_version
  let a0 = v(a), b0 = v(b)
  apply(a, [doc('by a')], fed())
  assertEquals(v(a), a0, 'own commits never bump it')
  assert(v(b) != b0, "a's commit bumps b's data_version")
  a.close()
  b.close()
})

slow(
  'the data-version poll wakes a foreign write, then goes quiet',
  async () => {
    let path = Deno.makeTempDirSync({ prefix: 'catchup' }) + '/g.db'
    let mine = open(path)
    let rows: number[] = []
    let feed = catchup(mine, (r) => rows.push(r.rowid))
    feed.watch(path)
    await new Promise((go) => setTimeout(go, 50)) // let the poll arm
    let peer = connect(path)
    apply(peer, [doc('foreign')], fed())
    await until(() => rows.length == 1, { label: 'the foreign row to settle' })
    // Quiescence: no writes, no passes — the feed must not feed itself.
    await new Promise((go) => setTimeout(go, 200))
    assertEquals(rows.length, 1)
    feed.stop()
    peer.close()
    mine.close()
  },
)
