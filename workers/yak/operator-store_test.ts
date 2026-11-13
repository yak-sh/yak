// The Operator's store: its drain works a slice an alarm and keeps its
// vocabulary's retention, and a wake fits its file once a schema.
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import {
  drain,
  FITTED,
  type OperatorStore,
  operatorStore,
} from './operator-store.ts'
import { durable } from '../../packages/durable-object/testing.ts'
import { operatorMemory } from './operator-testing.ts'

// A store whose every step owes another (forks forking) is worked a slice per
// alarm: past `until` nothing more starts, and drain answers now so the next
// alarm takes it up.
test('a drain past its slice starts nothing and answers now; the next works on', async () => {
  let ran: string[] = []
  let ask = (n: number) => ({
    entity: { eid: crypto.randomUUID() },
    operator_request: { channel: String(n) },
  })
  let store = operatorMemory()
  store.fx.handle({
    operator_receive: async (e) => {
      let n = Number(e.comp?.channel)
      ran.push(String(n))
      if (n < 3) await store.g.apply([ask(n + 1)], { trusted: true })
    },
  })
  await store.g.apply([ask(1)], { trusted: true })
  let before = Date.now()
  let next = await drain(store, before - 1)
  assertEquals([ran, next! >= before && next! <= Date.now()], [[], true])
  assertEquals(await drain(store), null)
  assertEquals(ran, ['1', '2', '3'])
})

// The store keeps its vocabulary's retention, as a local host's daily duty
// does: a row past its declared expiry goes on the next wake.
test('a drain expires what the vocabulary declares expired', async () => {
  let store = operatorMemory()
  let row = (at: string) => ({
    announced: { call: crypto.randomUUID() },
    created: { at },
  })
  let old = row(new Date(Date.now() - 2 * 86_400_000).toISOString())
  let fresh = row(new Date().toISOString())
  await store.g.apply([old, fresh] as never, { trusted: true, stamp: false })
  await drain(store)
  let left = await store.g.read('.announced')
  assertEquals(left.map((b) => b.announced), [fresh.announced])
})

// What a wake asks of its file beyond reading it: the schema's DDL and every
// write, any of which holds the object's answer until storage confirms it.
let fitted = durable()
await operatorStore(fitted, { version: 'v1' })
let written = async (version: string) => {
  let said: string[] = []
  let exec = fitted.sql.exec
  fitted.sql.exec = (query, ...bindings) => (
    said.push(query), exec(query, ...bindings)
  )
  try {
    await operatorStore(fitted, { version })
  } finally {
    fitted.sql.exec = exec
  }
  return said.filter((q) => !/^\s*(select|pragma|savepoint|release)\b/i.test(q))
}

test('a wake whose schema its store was fitted to runs no DDL and writes nothing, under any Worker version, and one fitted to another schema fits it again', async () => {
  assertEquals(await written('v1'), [])
  assertEquals(await written('v2'), [])
  // What a release that fitted once a Worker version recorded.
  fitted.sql.exec(`update server_meta set v = 'v1' where k = '${FITTED}'`)
  assertEquals((await written('v2')).length > 0, true)
  assertEquals(await written('v3'), [])
})

// The Operator's `search` tool reads a bare word through the search indexes.
// A store fitted before any entry was written holds no `entry` table then; the
// first entry's write makes the index over it, and a file whose fitting made
// none heals on its next wake.
let said = (body: string) => {
  let session = crypto.randomUUID()
  return [{ entity: { eid: session }, session: { id: session } }, {
    entity: { eid: crypto.randomUUID() },
    entry: { session, seq: 1 },
    content: { body },
  }]
}
let found = async (g: OperatorStore['g'], word: string) =>
  (await g.read(word)).map((b) => (b.content as { body: string }).body)

test('a word is found in an entry written after its store was fitted', async () => {
  let { g } = await operatorStore(durable())
  await g.apply(said('the wyrmling hatched'), { trusted: true })
  assertEquals(await found(g, 'wyrmling'), ['the wyrmling hatched'])
})

test('a file fitted with no index over its entries makes and fills one on its next wake', async () => {
  let file = durable()
  let { g } = await operatorStore(file)
  await g.apply(said('the wyrmling hatched'), { trusted: true })
  for (
    let [type, name] of file.sql.exec(
      `select type, name from sqlite_schema where name like 'entry\\_%' escape '\\' and type in ('trigger', 'view', 'table') and name not in ('entry')`,
    ).toArray().map((r) => [r.type, r.name])
  ) {
    if (!String(name).startsWith('entry_fts_')) {
      file.sql.exec(`drop ${type} if exists "${name}"`)
    }
  }
  file.sql.exec(`update server_meta set v = 'before' where k = '${FITTED}'`)
  assertEquals(await found((await operatorStore(file)).g, 'wyrmling'), [
    'the wyrmling hatched',
  ])
})
