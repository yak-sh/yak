// The round-trip count, at both ends of it: the ambient tally itself (hops.ts),
// and the number a `/query` reports as `Server-Timing: hops;dur=<n>`.
//
// What is being defended is the reason the count exists. A duration says a
// request got slower; only a count says it got slower because something began
// asking one row at a time, and an N+1 is the bug we keep writing. So the
// assertions here are EXACT: reading one entity costs the statements it costs,
// and a change to that is a change somebody meant to make.
import { assertEquals, assertMatch } from '@std/assert'
import { counts, hop, type Tally, tallying } from './hops.ts'
import { apply } from './db.ts'
import { freshDb } from './testdb.ts'
import { askOf, askRows, layered } from './graph_query.ts'
import { slow } from './testing.ts'

Deno.env.set('DB_PATH', ':memory:')

Deno.test('a hop counts on the tally that is running, and nowhere else', () => {
  let tally: Tally = new Map()
  // Outside every `tallying`, a hop is a no-op — a seam called by a script,
  // a boot, or a test is not a request and has nobody to report to.
  hop('hops')
  assertEquals(tally.size, 0)
  tallying(tally, () => {
    hop('hops')
    hop('hops')
    hop('r2.get')
    hop('r2.put', 3)
  })
  // The header's two numbers: store hops as they were named, and every `r2.*`
  // verb summed, since what a caller spent is how many times the bucket was
  // asked and not which verb asked it.
  assertEquals(counts(tally), { hops: 2, r2: 4 })
  hop('hops')
  assertEquals(counts(tally).hops, 2)
})

Deno.test('a nested tally is the inner one, and the outer resumes', () => {
  let outer: Tally = new Map()
  let inner: Tally = new Map()
  tallying(outer, () => {
    hop('hops')
    tallying(inner, () => hop('hops'))
    hop('hops')
  })
  assertEquals([counts(outer).hops, counts(inner).hops], [2, 1])
})

// What reading ONE entity by id costs in statements. The read fans out over
// the component tables rather than joining them, which is exactly what the
// count is here to show: it is not a bug asserted as correct, it is the number
// a fix has to move — and until somebody moves it, the number that must not
// grow. The same number twice below, in-process and over HTTP, because the
// route is an adapter and adds nothing of its own.
let ONE = 145

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

// And the same number on the wire. The boot is the heavy tier's (agg_sub_test.ts
// keeps the same seat rule), so the fast run pays nothing for it.
let U = ''
if (Deno.env.get('TASKS_SLOW')) {
  Deno.env.set('PORT', '0')
  let { http } = await import('./server.ts')
  U = `127.0.0.1:${(http.addr as Deno.NetAddr).port}`
}
let alone = { sanitizeOps: false, sanitizeResources: false }

slow('a /query says its statement count in Server-Timing', alone, async () => {
  let eid = crypto.randomUUID()
  let wrote = await fetch(`http://${U}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([{ eid, name: 'doc', comp: { title: 'hops' } }]),
  })
  await wrote.text()
  assertMatch(wrote.headers.get('server-timing') ?? '', /^hops;dur=\d+$/)
  let res = await fetch(`http://${U}/query?id=${eid}`)
  assertEquals((await res.json()).length, 1)
  assertEquals(res.headers.get('server-timing'), `hops;dur=${ONE}`)
})
