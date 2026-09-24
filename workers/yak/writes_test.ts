// The write log (writes.ts) over one store's storage, woken as new
// incarnations the way a deploy wakes it: writes kept while the store refuses
// to start, then replayed in order, once, by the alarm alone.
import { assert, assertEquals, assertRejects } from '@std/assert'
import { sha256 } from '@yaks/graph'
import { doorOf } from './door.ts'
import { Store } from './graph.ts'
import { state } from './harness.ts'
import { KERNEL, metaOf } from './meta.ts'
import { keyed, Pending } from './writes.ts'

let NAME = 'ada/notes'

// One object's storage, and a way to wake it again over the same rows.
let object = () => {
  let ctx = state()
  let store = new Store(ctx)
  let wake = () => store = new Store(ctx)
  let door = () => metaOf(doorOf((r) => store.fetch(r), NAME))
  let apply = (b: unknown[]) => door().apply(b as never, KERNEL)
  let sql = (q: string) => ctx.storage.sql.exec(q).toArray()
  let title = async (eid: string) =>
    ((await door().query(`.eid=${eid}`))[0]?.doc as { title?: string })?.title
  return { ctx, wake, apply, sql, title, alarm: () => store.alarm() }
}

// What breaking a deploy looks like from inside: the vocabulary the object
// boots from no longer loads, so it refuses to start.
let broken = (o: ReturnType<typeof object>) => {
  o.sql(
    "insert into yak_kv (k, v) values ('vocab', 'not json') " +
      'on conflict(k) do update set v = excluded.v',
  )
  o.wake()
}
let mended = (o: ReturnType<typeof object>) => {
  o.sql("update yak_kv set v = '{}' where k = 'vocab'")
  o.wake()
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
  assertEquals(
    o.sql("select count(*) n from yak_writes where state = 'pending'"),
    [{ n: 3 }],
  )
  // The alarm that brings the object back for them is set.
  assert(await o.ctx.storage.getAlarm())
  mended(o)
  await o.alarm()
  assertEquals(await o.title('n1'), 'two')
  assertEquals(await o.title('n2'), 'other')
  assertEquals(o.sql('select count(*) n from yak_writes'), [{ n: 0 }])
  // Woken again, it has nothing left to replay.
  o.wake()
  await o.alarm()
  assertEquals(await o.title('n1'), 'two')
})

Deno.test('a write refused on its own input is answered and not kept', async () => {
  let o = object()
  await assertRejects(() => o.apply([titled('n1', 'one', sha256('nope'))]))
  assertEquals(o.sql('select count(*) n from yak_writes'), [{ n: 0 }])
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
  assertEquals(o.sql('select seq, state from yak_writes'), [{
    seq: 1,
    state: 'refused',
  }])
})

Deno.test('a body carrying a key is never kept', () => {
  let key = { entity: { eid: 's' }, secret: { name: 'k', value: 'sk-1' } }
  let call = {
    entity: { eid: 'c' },
    call: { args: JSON.stringify({ bundles: [key] }) },
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
