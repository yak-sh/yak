// The write log (writes.ts) over one store's storage, woken as new
// incarnations the way a deploy wakes it: writes kept while the store refuses
// to start, then replayed in order, once, by the alarm alone.
import { assert, assertEquals, assertRejects } from '@std/assert'
import { sha256 } from '@yaks/graph'
import { doorOf, type Namespace, storeOf } from './door.ts'
import { Store } from './graph.ts'
import { by, lit, scan, tally } from '@yaks/sql'
import { db, keep, named, state } from './testing.ts'
import { KERNEL, metaOf, minted } from './meta.ts'
import { keyed, Pending } from './writes.ts'

let NAME = 'ada/notes'

// One object's storage, and a way to wake it again over the same rows.
let object = () => {
  let ctx = state()
  let store = new Store(ctx)
  let wake = () => store = new Store(ctx)
  let fetch = (r: Request) => store.fetch(r)
  let door = () => metaOf(doorOf(fetch, NAME))
  let apply = (b: unknown[]) => door().apply(b as never, KERNEL)
  let writes = (state?: string) =>
    tally(db(ctx), 'yak_writes', state ? by({ state }) : undefined)
  let query = (q: string) => door().query(q)
  let title = async (eid: string) =>
    ((await query(`.eid=${eid}`))[0]?.doc as { title?: string })?.title
  return {
    ctx,
    wake,
    fetch,
    apply,
    writes,
    query,
    title,
    alarm: () => store.alarm(),
  }
}

// The object as the kernel reaches it (door.ts `storeOf`), where the runtime
// resets it once, after the first batch commits and before its answer leaves:
// what a platform deploy does to a write in flight.
let resetting = (o: ReturnType<typeof object>): Namespace => {
  let reset = true
  return {
    idFromName: (name) => name,
    get: () => ({
      fetch: async (req) => {
        let r = await o.fetch(req)
        if (!reset) return r
        reset = false
        o.wake()
        throw new Error(
          'Durable Object storage operation exceeded timeout which caused object to be reset.',
        )
      },
    }),
  }
}

// What breaking a deploy looks like from inside: the vocabulary the object
// boots from no longer loads, so it refuses to start.
let broken = (o: ReturnType<typeof object>) => {
  keep(o.ctx, 'vocab', 'not json')
  o.wake()
}
let mended = (o: ReturnType<typeof object>) => {
  keep(o.ctx, 'vocab', '{}')
  o.wake()
}

// A failure only one write meets, the way any bug under a write throws: the
// object's SQLite failing on a row that carries `word`. The cure takes it away.
let poisoned = (o: ReturnType<typeof object>, word: string) => {
  let sql = o.ctx.storage.sql
  let exec = sql.exec
  sql.exec = (query, ...bindings) => {
    if (bindings.includes(word)) throw new Error('SQLITE_IOERR: disk I/O error')
    return exec.call(sql, query, ...bindings)
  }
  return () => void (sql.exec = exec)
}

let titled = (eid: string, title: string, was?: string | null) => ({
  entity: { eid },
  doc: { title },
  ...(was === undefined ? {} : { $was: { doc: { title: was } } }),
})

Deno.test('writes a refusing store was sent apply in order, once, when it is mended', async () => {
  let o = object()
  await o.apply([titled('n1', 'zero')])
  broken(o)
  let kept = [
    titled('n1', 'one', sha256('zero')),
    titled('n1', 'two', sha256('one')),
    titled('n2', 'other'),
  ]
  for (let b of kept) await assertRejects(() => o.apply([b]), Pending)
  assertEquals(o.writes('pending'), 3)
  // The alarm that brings the object back for them is set.
  assert(await o.ctx.storage.getAlarm())
  mended(o)
  await o.alarm()
  assertEquals(await o.title('n1'), 'two')
  assertEquals(await o.title('n2'), 'other')
  assertEquals(o.writes(), 0)
  // Woken again, it has nothing left to replay.
  o.wake()
  await o.alarm()
  assertEquals(await o.title('n1'), 'two')
})

Deno.test('a write the store fails on is set aside, and the writes behind it go through', async () => {
  let o = object()
  let cure = poisoned(o, 'poison')
  await assertRejects(() => o.apply([titled('n1', 'poison')]), Pending)
  await o.apply([titled('n2', 'good')])
  assertEquals(await o.title('n2'), 'good')
  assertEquals(o.writes('failed'), 1)
  // Fixed code arrives as a new incarnation, which applies what was set aside.
  cure()
  o.wake()
  assertEquals(await o.title('n1'), 'poison')
  assertEquals(o.writes(), 0)
})

Deno.test('a batch sent again after a reset lost its answer is applied once', async () => {
  let o = object()
  let applied = await metaOf(storeOf(resetting(o), NAME)).apply(
    [{ entity: { eid: '$n' }, doc: { title: 'once' } }],
    KERNEL,
  )
  let rows = await o.query('.doc')
  assertEquals(rows.map((b) => b.entity.eid), [minted(applied).$n])
})

Deno.test('an interrupted write keeps its body while reads recover and explicit retry applies once', async () => {
  let o = object()
  broken(o)
  await assertRejects(() => o.apply([titled('n1', 'once')]), Pending)
  // The earlier attempt marker survives the graph transaction's reset.
  db(o.ctx).query({
    t: 'update',
    table: 'yak_writes',
    set: { state: lit('running') },
  })
  mended(o)
  assertEquals(await o.title('n1'), undefined)
  assertEquals(o.writes('interrupted'), 1)
  let inspect = () =>
    o.fetch(
      new Request('http://store/writes?seq=1', {
        headers: KERNEL,
      }),
    )
  let denied = await o.fetch(new Request('http://store/writes?seq=1'))
  assertEquals(denied.status, 404)
  let [write] = await (await inspect()).json()
  assertEquals(write.state, 'interrupted')
  assertEquals(JSON.parse(write.body), [titled('n1', 'once')])
  let body = write.body
  let at = write.at
  let retried = await o.fetch(
    new Request('http://store/writes?seq=1', {
      method: 'POST',
      headers: KERNEL,
    }),
  )
  assertEquals(retried.status, 200)
  assertEquals(await o.title('n1'), 'once')
  assertEquals(o.writes('interrupted'), 0)
  let [landed] = await (await inspect()).json()
  assertEquals([landed.state, landed.body, landed.at, landed.status], [
    'applied',
    body,
    at,
    200,
  ])
  assertEquals(JSON.parse(landed.answer)[0].doc.title, 'once')
  db(o.ctx).query({
    t: 'update',
    table: 'yak_writes',
    set: { at: lit('2000-01-01T00:00:00.000Z') },
  })
  await o.apply([titled('n2', 'later')])
  assertEquals((await (await inspect()).json())[0].body, body)
  assertEquals(
    (await o.fetch(
      new Request('http://store/writes?seq=1', {
        method: 'POST',
        headers: KERNEL,
      }),
    )).status,
    400,
  )
  let rows = await o.query('.doc')
  assertEquals(rows.map((r) => r.entity.eid).sort(), ['n1', 'n2'])
})

Deno.test('a failed reviewed attempt stays held until another explicit retry', async () => {
  let o = object()
  broken(o)
  await assertRejects(() => o.apply([titled('n1', 'poison')]), Pending)
  db(o.ctx).query({
    t: 'update',
    table: 'yak_writes',
    set: { state: lit('running') },
  })
  mended(o)
  assertEquals(await o.title('n1'), undefined)
  let cure = poisoned(o, 'poison')
  let retry = () =>
    o.fetch(
      new Request('http://store/writes?seq=1', {
        method: 'POST',
        headers: KERNEL,
      }),
    )
  assertEquals((await retry()).status, 200)
  assertEquals(o.writes('failed'), 1)
  cure()
  o.wake()
  assertEquals(await o.title('n1'), undefined)
  assertEquals(o.writes('failed'), 1)
  assertEquals((await retry()).status, 200)
  assertEquals(await o.title('n1'), 'poison')
})

Deno.test('a legacy pending write waits for review before any replay', async () => {
  let o = object()
  broken(o)
  let batch = [titled('n0', 'one')]
  await assertRejects(() => o.apply(batch), Pending)
  db(o.ctx).query({
    t: 'update',
    table: 'yak_writes',
    set: { generation: lit(null) },
  })
  mended(o)
  assertEquals(await o.title('n0'), undefined)
  assertEquals(o.writes('unreviewed'), 1)
  let [write] = await (await o.fetch(
    new Request('http://store/writes', {
      headers: KERNEL,
    }),
  )).json()
  assertEquals([write.seq, write.state, write.body], [
    1,
    'unreviewed',
    undefined,
  ])
  let [named] = await (await o.fetch(
    new Request(
      'http://store/writes?seq=1',
      { headers: KERNEL },
    ),
  )).json()
  assertEquals(JSON.parse(named.body), batch)
  o.wake()
  assertEquals(await o.title('n0'), undefined)
  assertEquals(o.writes('unreviewed'), 1)
  assertEquals(
    (await o.fetch(
      new Request('http://store/writes?seq=1', {
        method: 'POST',
        headers: KERNEL,
      }),
    )).status,
    200,
  )
  assertEquals(await o.title('n0'), 'one')
  let [applied] = await (await o.fetch(
    new Request(
      'http://store/writes?seq=1',
      { headers: KERNEL },
    ),
  )).json()
  assertEquals(applied.state, 'applied')
  assertEquals(applied.body, named.body)
})

Deno.test('a write from an older log shape can be inspected and retried', async () => {
  let o = object()
  broken(o)
  await assertRejects(() => o.apply([titled('n1', 'kept')]), Pending)
  // The log as that code raised it: no key and no answer, nor their index.
  let d = db(o.ctx)
  for (let name of named(o.ctx, { type: 'index', tbl_name: 'yak_writes' })) {
    d.query({ t: 'drop', kind: 'index', name })
  }
  for (let drop of ['idempotency_key', 'answer', 'generation']) {
    d.query({ t: 'alter table', table: 'yak_writes', drop })
  }
  mended(o)
  assertEquals(await o.title('n1'), undefined)
  assertEquals(o.writes('unreviewed'), 1)
  assertEquals(
    (await o.fetch(
      new Request('http://store/writes?seq=1', {
        method: 'POST',
        headers: KERNEL,
      }),
    )).status,
    200,
  )
  assertEquals(await o.title('n1'), 'kept')
  assertEquals(o.writes('applied'), 1)
})

Deno.test('a write refused on its own input is answered and not kept', async () => {
  let o = object()
  await assertRejects(() => o.apply([titled('n1', 'one', sha256('nope'))]))
  assertEquals(o.writes(), 0)
})

Deno.test('a replay that no longer applies is kept as refused, and the rest go on', async () => {
  let o = object()
  broken(o)
  await assertRejects(
    () => o.apply([titled('n1', 'one', sha256('nope'))]),
    Pending,
  )
  await assertRejects(() => o.apply([titled('n2', 'two')]), Pending)
  mended(o)
  // The first request after the mend replays before it is answered.
  assertEquals(await o.title('n2'), 'two')
  assertEquals(await o.title('n1'), undefined)
  assertEquals(scan(db(o.ctx), 'yak_writes', undefined, ['seq', 'state']), [{
    seq: 1,
    state: 'refused',
  }])
})

Deno.test('a body carrying a key is never kept', () => {
  let key = { entity: { eid: 's' }, secret: { name: 'k', value: 'sk-1' } }
  let call = {
    entity: { eid: 'c' },
    call: { args: { bundles: [key] } },
  }
  assertEquals(
    [
      [key],
      { entities: [key] },
      [call],
      [{ entity: { eid: 's' }, secret: { name: 'k' } }],
      [titled('n1', 'one')],
      'not json, secret',
    ].map((b) => keyed(typeof b == 'string' ? b : JSON.stringify(b))),
    [true, true, true, false, false, true],
  )
})
