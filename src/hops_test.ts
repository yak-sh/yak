// The round-trip count as the fleet server spends it: the number a `/query`
// reports as `Server-Timing: hops;dur=<n>`. The tally itself is tested beside
// it (workers/yak/lib/hops_test.ts).
//
// What is being defended is the reason the count exists. A duration says a
// request got slower; only a count says it got slower because something began
// asking one row at a time, and an N+1 is the bug we keep writing. So the
// assertions here are EXACT: reading one entity costs the statements it costs,
// and a change to that is a change somebody meant to make.
import { assertEquals, assertMatch } from '@std/assert'
import { counts, type Tally, tallying } from '../workers/yak/lib/hops.ts'
import { apply, human } from './db.ts'
import { freshDb } from './testdb.ts'
import { askOf, askRows, layered } from './graph_query.ts'
import { slow } from '../bin/testing.ts'

Deno.env.set('DB_PATH', ':memory:')

Deno.test('human reads the spine and worn names, not one table per kind', () => {
  let db = freshDb()
  let eid = crypto.randomUUID()
  apply(db, [
    { eid, name: 'doc', comp: { title: 'named' }, $num: true },
    { eid, name: 'task', comp: {} },
    { eid, name: 'filed', comp: { priority: 'P2' } },
  ])
  let { num } = db.prepare('select num from entity where eid = ?').get(eid) as {
    num: number
  }
  let expect = (eid: string, id: string, hops: number) => {
    let tally: Tally = new Map()
    assertEquals(tallying(tally, () => human(db, eid)), id)
    assertEquals(counts(tally).hops, hops)
  }
  // Precedence, a late kind, and no kind all cost the same two statements.
  expect(eid, `T-${num}`, 2)
  apply(db, [{ eid, name: 'task', comp: null }])
  expect(eid, `D-${num}`, 2)
  apply(db, [{ eid, name: 'entity', comp: null }])
  expect(eid, `E-${num}`, 2)

  // Num-less handles derive their kind too, whether the spine exists or not.
  let cheap = 'dead1234-0000-4000-8000-00000000cafe'
  expect(cheap, 'E#dead123400', 2)
  db.prepare('insert into entity (eid) values (?)').run(cheap)
  // An unclassified raw-SQL birth needs one physical fallback census. Normal
  // writes above retain their exact two-statement bound.
  expect(cheap, 'E#dead123400', 3)
})

// What reading ONE entity by id costs in statements. A read visits the
// components the results WEAR — one statement says which (db.ts `worn`), and
// the rest read those — so the number is the shape of the answer and not the
// size of the vocabulary. It was 145, one statement per declared component
// whether or not anything wore it. The same number twice below, in-process and
// over HTTP, because the route is an adapter and adds nothing of its own.
let ONE = 6

Deno.test('reading one entity is the statements it costs', async () => {
  let db = freshDb()
  let eid = crypto.randomUUID()
  apply(db, [{ eid, name: 'doc', comp: { title: 'one' } }])
  let tally: Tally = new Map()
  // The /query body, called the way the route calls it (server_runtime.ts):
  // segments in, rows out, through the one askOf/askRows/layered door.
  let rows = await tallying(tally, async () => {
    let ask = askOf([`id=${eid}`])
    return layered(db, await askRows(db, ask), ask)
  })
  assertEquals(rows.length, 1)
  assertEquals(counts(tally).hops, ONE)
})

// And what a LIST costs. The point of the number is that it is the SAME ORDER
// as one row's: a hundred rows wearing the same handful of components are read
// in the same handful of statements, and neither count grows with how many
// components the vocabulary declares — which is what made a single-entity read
// cost 143.
Deno.test('a hundred rows cost the components they wear, not the vocabulary', async () => {
  let db = freshDb()
  for (let i = 0; i < 100; i++) {
    let eid = crypto.randomUUID()
    apply(db, [
      { eid, name: 'doc', comp: { title: `row ${i}` } },
      { eid, name: 'task', comp: {} },
      { eid, name: 'filed', comp: { priority: 'P2' } },
    ])
  }
  let tally: Tally = new Map()
  let rows = await tallying(tally, async () => {
    let ask = askOf(['.filed.priority=P2', 'limit=100'])
    return layered(db, await askRows(db, ask), ask)
  })
  assertEquals(rows.length, 100)
  // Filing is now a separate worn component: one extra table read, not N.
  // Two plan-time catalog reads replace the component census, and the
  // catalog's version probe rides beside them on a connection's first plan.
  assertEquals(counts(tally).hops, 9)
})

// And the same number on the wire. The boot is the heavy tier's (agg_sub_test.ts
// keeps the same seat rule), so the fast run pays nothing for it.
let U = ''
if (Deno.env.get('TASKS_SLOW')) {
  Deno.env.set('PORT', '0')
  let { http } = await import('./server.ts')
  U = `127.0.0.1:${(http.addr as Deno.NetAddr).port}`
}
let alone = { sanitizeOps: false, sanitizeResources: false }

// Three numbers on the answer, and the third is the point of the other two:
// `total` is the wall time, `hops` what it was spent on, `rows` how much came
// back. A read's rows are the entities it answered with; a write's are the
// changes that landed, which is more than the batch asked for — the spine and
// the stamps ride back in the same list.
slow('a /query says its statement count in Server-Timing', alone, async () => {
  let eid = crypto.randomUUID()
  let wrote = await fetch(`http://${U}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([{ eid, name: 'doc', comp: { title: 'hops' } }]),
  })
  await wrote.text()
  assertMatch(
    wrote.headers.get('server-timing') ?? '',
    /^hops;dur=\d+, rows;dur=[1-9]\d*, total;dur=\d+$/,
  )
  let res = await fetch(`http://${U}/query?id=${eid}`)
  assertEquals((await res.json()).length, 1)
  assertMatch(
    res.headers.get('server-timing') ?? '',
    new RegExp(`^hops;dur=${ONE}, rows;dur=1, total;dur=\\d+$`),
  )
})
