// The store as a whole: bound to a driver and a vocabulary, it installs its
// schema and speaks bundles — a write in, a read out, over one round trip.

import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { storage } from './mod.ts'
import { mem, shop } from './harness.ts'

Deno.test('ddl() lists the statements install() runs', () => {
  let s = storage(mem(), shop)
  let ddl = s.ddl()
  assert(ddl.length > 0)
  assert(ddl.some((stmt) => stmt.includes('create table if not exists entity')))
})

Deno.test('install() is idempotent', () => {
  let s = storage(mem(), shop)
  s.install()
  s.install() // create-if-not-exists — a second run is a no-op, not an error
  s.tx((tx) => tx.patch([{ entity: { eid: 'x' }, doc: { title: 'Hi' } }]))
  assertEquals((s.read('.title~=hi') as Bundle[])[0].entity.eid, 'x')
})

Deno.test('a driver that owns transactions is asked for them', () => {
  let base = mem()
  let seen: string[] = []
  let depth = 0
  let s = storage({
    ...base,
    exec: (sql) => {
      seen.push(sql)
      base.exec(sql)
    },
    // Stands in for an engine whose transactions are not SQL (a Durable
    // Object's `transactionSync`): the store must call this and emit no
    // savepoint of its own.
    tx: (body) => {
      depth++
      try {
        return body()
      } finally {
        depth--
      }
    },
  }, shop)
  s.install()
  let inside = s.tx((tx) => {
    tx.patch([{ entity: { eid: 'p1' }, doc: { title: 'Kettle' } }])
    return depth
  })
  assertEquals(inside, 1)
  assert(!seen.some((sql) => /savepoint|rollback|release/.test(sql)))
  assertEquals((s.read('.title~=kettle') as Bundle[])[0].entity.eid, 'p1')
})

Deno.test('a bundle written and read back is the same entity', () => {
  let s = storage(mem(), shop)
  s.install()
  s.tx((tx) =>
    tx.patch([{
      entity: { eid: 'p1' },
      doc: { title: 'Kettle' },
      product: { price: 40, status: 'live' },
    }])
  )
  let [p] = s.read('.kind=product') as Bundle[]
  assertEquals(p.entity.eid, 'p1')
  assertEquals((p.doc as Record<string, unknown>).title, 'Kettle')
  assertEquals((p.product as Record<string, unknown>).price, 40)
  assertEquals((p.product as Record<string, unknown>).status, 'live')
})
