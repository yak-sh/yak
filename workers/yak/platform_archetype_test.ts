import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { durable } from '../../packages/durable-object/testing.ts'
import { GIT_STORE, PLATFORM_STORE } from './door.ts'
import { Store } from './graph.ts'

for (const name of [PLATFORM_STORE, GIT_STORE]) {
  Deno.test(`${name}: classification, legacy backfill, and immutable metadata`, async () => {
    const storage = durable()
    const ctx = { storage, getWebSockets: () => [], acceptWebSocket: () => {} }
    let store = new Store(ctx)
    const request = (path: string, body?: unknown) =>
      store.fetch(
        new Request(
          'http://store' + path,
          {
            headers: { 'x-store': name, 'x-yak-kernel': '1' },
            ...(body === undefined
              ? {}
              : { method: 'POST', body: JSON.stringify(body) }),
          },
        ),
      )
    const eid = 'a0000000-0000-4000-8000-000000000099'
    const seed = name == PLATFORM_STORE
      ? { person: {}, doc: { title: 'Test person' } }
      : { gitobj: { type: 'blob', size: 3 }, blob: { sha: 'a'.repeat(64) } }
    let res = await request('/apply', [{ entity: { eid }, ...seed }])
    assertEquals(res.status, 200, await res.clone().text())
    const read = async () =>
      await (await request('/query?q=.eid=' + eid)).json() as Bundle[]
    const original = (await read())[0]
    assert(original.entity.archetype)
    const descriptors = await (await request('/query?q=.archetype'))
      .json() as Bundle[]
    assert(descriptors.some((b) => b.entity.eid == original.entity.archetype))
    const forged = await request('/apply', [{
      entity: { eid: 'forged-descriptor' },
      archetype: { tables: '["person"]' },
    }])
    assertEquals(forged.status, 400)
    assertEquals(
      await (await request('/query?q=.eid=forged-descriptor&.archetype'))
        .json(),
      [],
    )
    // Simulate the previous schema with physical data but no classification.
    storage.sql.exec('update entity set archetype=null')
    const ids = storage.sql.exec('select entity from archetype').toArray()
    storage.sql.exec('drop table retired')
    storage.sql.exec('drop table archetype')
    for (const row of ids) {
      storage.sql.exec('delete from entity where id=?', Number(row.entity))
    }
    storage.sql.exec("update yak_kv set v='pre-archetypes' where k='schema'")
    store = new Store(ctx)
    assertEquals((await read())[0], original)
    const stamp = storage.sql.exec("select v from yak_kv where k='schema'")
      .toArray()
    store = new Store(ctx)
    assertEquals((await read())[0], original)
    assertEquals(
      storage.sql.exec("select v from yak_kv where k='schema'").toArray(),
      stamp,
    )
    res = await request('/apply', [{
      entity: { eid },
      alias: { name: 'classified-test' },
    }])
    assertEquals(res.status, 200, await res.clone().text())
    assert((await read())[0].entity.archetype != original.entity.archetype)
    res = await request('/apply', [{ entity: { eid }, alias: null }])
    assertEquals(res.status, 200)
    assertEquals((await read())[0].alias, undefined)
    const final = (await read())[0]
    const shape =
      (await (await request('/query?q=.eid=' + final.entity.archetype)).json())[
        0
      ]
    assert(!JSON.parse(shape.archetype.tables).includes('alias'))
    storage[Symbol.dispose]()
  })
}
