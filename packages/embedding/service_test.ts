// The service: a loop over the queue, whoever wrote what it holds.

import { equal, test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { service } from './service.ts'
import { TABLE } from './ddl.ts'
import { retries } from './remote.ts'
import { OVERDUE, Overdue } from './outage.ts'
import { Unanswered } from './embedder.ts'
import type { Host } from './service.ts'
import { insert, type Statements, tally } from '@yaks/sql'
import { entity } from '../sqlite/testing.ts'
import type { Options, Rows } from './options.ts'
import { none, serving, shelf, shop } from './testing.ts'

retries.waits = [0]

let count = (db: Statements) => tally(db, TABLE)

let until = async (want: () => boolean) => {
  for (let i = 0; i < 400 && !want(); i++) {
    await new Promise((go) => setTimeout(go, 1))
  }
  assert(want(), 'the service never got there')
}

// A service running over a fresh shop until the test is done with it.
let running = (
  options: Options,
  graph: Rows = none,
  db = shelf(),
  host: Partial<Host> = {},
) => {
  let stop = new AbortController()
  let done = service(
    { vocab: shop, storage: { statements: db }, graph, ...host },
    options,
    stop.signal,
  )
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
  await service({ vocab: shop, storage: { statements: db }, graph: none }, {
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

test('a model that cannot be reached is logged, and the work waits for it', async () => {
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

// A service whose model fails as `fail` says, on a clock the test holds, and
// what it reports and logs.
let failing = (fail: () => Error | undefined) => {
  let at = 0, passes = 0
  let reports: { error: unknown; tags: Record<string, string> }[] = []
  let embedders = {
    lent: () => ({
      model: 'lent',
      embed: () => {
        passes++
        let error = fail()
        if (error) throw error
        return new Float32Array([1, 0, 0])
      },
    }),
  }
  let run = running(
    {
      after: 1,
      batch: 1,
      now: () => at,
      embedder: { provider: 'lent', model: 'lent' },
    },
    none,
    shelf(),
    {
      embedders,
      report: (error, { tags }) => void reports.push({ error, tags }),
    },
  )
  let after = async (n: number) => {
    let from = passes
    await until(() => passes >= from + n)
  }
  return {
    ...run,
    reports,
    after,
    set: (ms: number) => (at = ms),
  }
}

let unanswered = () =>
  new Unanswered('box', { model: 'lent', texts: '1', tries: '4' }, 'down')

test('a bug in a pass is reported once while passes keep failing by it, and its end is logged', async () => {
  await quiet(async (said) => {
    let error: Error | undefined = Error('no such table: embedding_owed')
    let s = failing(() => error)
    await s.after(10)
    equal(s.reports.map((r) => r.error), [error])
    equal(s.reports[0].tags, {
      package: '@yaks/embedding',
      step: 'embedding pass',
    })
    let other = Error('disk I/O error')
    error = other
    await s.after(10)
    equal(s.reports.map((r) => r.error).at(-1), other)
    equal(s.reports.length, 2)
    s.set(4_000)
    error = undefined
    await until(() => count(s.db) == 4)
    await s.end()
    equal(said, ['drains answer again after 4000 ms of Error: disk I/O error'])
  })
})

test('a model out past OVERDUE reports once, tagged with its wait, and its end is logged', async () => {
  await quiet(async (said) => {
    let up = false
    let s = failing(() => up ? undefined : unanswered())
    await s.after(10)
    equal(s.reports, [])
    s.set(OVERDUE)
    await s.after(10)
    equal(s.reports.length, 1)
    let [{ error, tags }] = s.reports
    equal(error instanceof Overdue, true)
    equal(tags.waited, `${OVERDUE} ms`)
    equal(tags.model, 'lent')
    up = true
    await until(() => count(s.db) == 4)
    await s.end()
    equal(said.length, 2, 'the outage logs its start and its end')
    equal(said[1], `the outage ended after ${OVERDUE} ms`)
  })
})
