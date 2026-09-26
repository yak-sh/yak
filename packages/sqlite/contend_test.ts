// Two processes on one file. What one of them holds the write lock for, the
// other's lookups and opens do not wait on: a connection here waits out a
// busy lock for five seconds (./db.ts), so a wait shows.

import { assert, assertEquals } from '@std/assert'
import { storage } from './mod.ts'
import { open } from './db.ts'
import { shop } from './testing.ts'

// This process's store, with a task in it, beside another connection that has
// begun writing and not finished.
let beside = () => {
  let dir = Deno.makeTempDirSync()
  let mine = open(`${dir}/graph.db`)
  let theirs = open(`${dir}/graph.db`)
  let store = storage(mine, shop)
  store.install()
  store.tx((tx) => tx.patch([{ entity: { eid: 'x' }, doc: { title: 'Hi' } }]))
  theirs.query({ t: 'begin', mode: 'immediate' })
  return {
    store,
    mine,
    [Symbol.dispose]: () => {
      theirs.query({ t: 'rollback' })
      theirs.close()
      mine.close()
      Deno.removeSync(dir, { recursive: true })
    },
  }
}

let prompt = <T>(f: () => T): T => {
  let t = performance.now()
  let out = f()
  let ms = performance.now() - t
  assert(ms < 1000, `waited ${Math.round(ms)}ms on the other writer`)
  return out
}

Deno.test('a lookup answers while another process is writing', () => {
  using p = beside()
  let [x] = prompt(() => p.store.get(['x']))
  assertEquals(x.entity.eid, 'x')
})

Deno.test('an open beside a writer goes on without it, and keeps its wait', () => {
  using p = beside()
  prompt(() => storage(p.mine, shop).install())
  assertEquals(p.mine.query({ t: 'pragma', name: 'busy_timeout' })[0], {
    timeout: 5000,
  })
})

Deno.test('a second open leaves a file its first open analyzed as it is', () => {
  let dir = Deno.makeTempDirSync()
  let d = open(`${dir}/graph.db`)
  try {
    let version = () => d.query({ t: 'pragma', name: 'schema_version' })[0]
    storage(d, shop).install()
    let was = version()
    storage(d, shop).install()
    assertEquals(version(), was)
  } finally {
    d.close()
    Deno.removeSync(dir, { recursive: true })
  }
})
