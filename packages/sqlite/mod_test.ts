// The store as a whole: bound to a driver and a vocabulary, it installs its
// schema and speaks bundles — a write in, a read out, over one round trip.

import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { type Driver, render } from '@yaks/sql'
import { storage, type Store } from './mod.ts'
import { open } from './db.ts'
import { mem, shop, spy } from './testing.ts'

Deno.test('ddl() lists the statements install() runs', () => {
  let s = storage(mem(), shop)
  let ddl = s.ddl()
  assert(ddl.length > 0)
  assert(
    ddl.some((s) =>
      render(s).sql.includes('create table if not exists "entity"')
    ),
  )
})

Deno.test('install() is idempotent', () => {
  let s = storage(mem(), shop)
  s.install()
  s.install() // create-if-not-exists — a second run is a no-op, not an error
  s.tx((tx) => tx.patch([{ entity: { eid: 'x' }, doc: { title: 'Hi' } }]))
  assertEquals((s.read('.title~=hi') as Bundle[])[0].entity.eid, 'x')
})

Deno.test('a second store over an installed file leaves its schema alone', () => {
  let d = mem()
  storage(d, shop).install()
  let version = () => d.query({ t: 'pragma', name: 'schema_version' })
  let before = version()
  storage(d, shop).install()
  assertEquals(version(), before)
})

Deno.test('a driver that owns transactions is asked for them', () => {
  let base = mem()
  let seen: string[] = []
  let depth = 0
  let s = storage({
    ...spy(base, (sql) => void seen.push(sql)),
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

Deno.test('a driver over a FILE takes the write lock up front', () => {
  // The arrangement every `yak` line depends on: a graph is a file, and as
  // many processes as there are lines typed have it open. A deferred
  // transaction that read before it wrote cannot upgrade once another
  // connection has committed — SQLITE_BUSY, instantly, whatever the busy
  // timeout says — so the outermost unit says `begin immediate` and the
  // timeout has something to wait on. Everything inside it is a savepoint, as
  // ever: one connection has one transaction whatever the nesting says.
  let said: string[] = []
  let watched = (over: Driver): Driver =>
    spy(over, (sql) => void said.push(sql))
  let write = (s: Store) =>
    s.tx((tx) => {
      tx.read('.doc')
      tx.patch([{ entity: { eid: 'p1' }, doc: { title: 'Kettle' } }])
    })

  let dir = Deno.makeTempDirSync({ prefix: 'yaks-file-' })
  let db = open(`${dir}/graph.sqlite`)
  try {
    let file = storage(watched(db), shop)
    file.install()
    said.length = 0
    write(file)
    assertEquals(said.filter((sql) => /^(begin|commit|savepoint)/.test(sql)), [
      'begin immediate',
      'commit',
    ])
    // And a unit inside that one is a savepoint: the lock is already held.
    said.length = 0
    file.tx(() => file.tx(() => 0))
    assertEquals(
      said.filter((sql) => /^(begin|savepoint)/.test(sql)).map((sql) =>
        sql.split('_')[0]
      ),
      ['begin immediate', 'savepoint "yaks'],
    )
  } finally {
    db.close()
    Deno.removeSync(dir, { recursive: true })
  }

  // An in-memory database is this process's alone, so nothing else can be
  // writing it and there is no lock to take.
  said.length = 0
  let alone = storage(watched(mem()), shop)
  alone.install()
  said.length = 0
  write(alone)
  assertEquals(said.filter((sql) => /^(begin|commit)/.test(sql)), [])
  assert(said.some((sql) => sql.startsWith('savepoint')), said.join(' · '))
})
