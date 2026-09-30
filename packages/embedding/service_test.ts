// The service: a loop over the queue, whoever wrote what it holds.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { service } from './service.ts'
import { TABLE } from './ddl.ts'
import { type Driver, insert, tally } from '@yaks/sql'
import { entity } from '../sqlite/testing.ts'
import type { Options, Rows } from './options.ts'
import { none, serving, shelf, shop } from './testing.ts'

let count = (db: Driver) => tally(db, TABLE)

let until = async (want: () => boolean) => {
  for (let i = 0; i < 400 && !want(); i++) {
    await new Promise((go) => setTimeout(go, 1))
  }
  assert(want(), 'the service never got there')
}

// A service running over a fresh shop until the test is done with it.
let running = (options: Options, graph: Rows = none, db = shelf()) => {
  let stop = new AbortController()
  let done = service({ vocab: shop, sql: db, graph }, options, stop.signal)
  return { db, end: () => (stop.abort(), done) }
}

// A model on a box, the one the config below names.
let box = () => serving({ name: 'box', api: 'ollama', base: 'http://box' }, 'm')

// Every warning a test's service says, instead of the console.
let quiet = async (test: (said: unknown[]) => Promise<void>) => {
  let said: unknown[] = []
  let warn = console.warn
  console.warn = (...w: unknown[]) => said.push(w[1])
  try {
    await test(said)
  } finally {
    console.warn = warn
  }
}

test('one pass when the signal has already ended, the way a command runs it', async () => {
  let db = shelf()
  await service({ vocab: shop, sql: db, graph: none }, {
    embedder: { provider: 'hash' },
  })
  assertEquals(count(db), 4)
})

test('a backlog drains pass after pass, then a write from anywhere is found', async () => {
  let { db, end } = running({
    embedder: { provider: 'hash' },
    batch: 1,
    after: 1,
  })
  await until(() => count(db) == 4)
  entity(db, 9, 'book-9')
  db.query(insert('book', { entity: 9, title: 'Late' }))
  await until(() => count(db) == 5)
  await end()
})

test('a key that arrives late starts the embedding, without anybody restarting', async () => {
  await quiet(async (said) => {
    let key: string | undefined
    let fetch = (_: string, init?: { body?: string }) => {
      let input: string[] = JSON.parse(init!.body!).input
      let body = { embeddings: input.map(() => [1, 0, 0]) }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(body)),
      })
    }
    let { db, end } = running({
      after: 1,
      embedder: {
        provider: 'box',
        model: 'm',
        fetch,
        get key() {
          return key
        },
      },
    }, await box())
    await until(() => said.length > 0)
    assertEquals(count(db), 0, 'nothing is embedded without a key')
    key = 'hunter2'
    await until(() => count(db) == 4)
    assertEquals(said.length, 1, 'and it is said once')
    await end()
  })
})

test('a model that cannot be reached is reported, and the work waits for it', async () => {
  await quiet(async (said) => {
    let up = false
    let fetch = (_: string, init?: { body?: string }) => {
      if (!up) return Promise.reject(new Error('no route to host'))
      let input: string[] = JSON.parse(init!.body!).input
      let body = { embeddings: input.map(() => [1, 0, 0]) }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(body)),
      })
    }
    let { db, end } = running({
      after: 1,
      embedder: { provider: 'box', model: 'm', fetch },
    }, await box())
    await until(() => said.length > 0)
    assertEquals(count(db), 0)
    up = true
    await until(() => count(db) == 4)
    await end()
  })
})

test('the host ending stops the loop: nothing runs afterwards', async () => {
  await quiet(async (said) => {
    let { db, end } = running({ embedder: { provider: 'hash' }, after: 1 })
    await until(() => count(db) == 4)
    await end()
    db.query({ t: 'drop', kind: 'table', name: 'book' })
    await new Promise((go) => setTimeout(go, 10))
    assertEquals(said, [])
  })
})
