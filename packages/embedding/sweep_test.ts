// The sweep: what it embeds, what it skips, and what it drops — found from a
// queue the database's triggers keep, whoever wrote.

import { assert, assertEquals, assertRejects } from '@std/assert'
import { type Expr, fn } from '@yaks/sql'
import { loadVocab } from '@yaks/vocab'
import { fields, searched } from './fields.ts'
import { sources, sweep } from './sweep.ts'
import { left, watch } from './owed.ts'
import { vectorOf } from './near.ts'
import { schema, TABLE } from './ddl.ts'
import { type Embedder, hashEmbedder, Refused } from './embedder.ts'
import { remote } from './remote.ts'
import { embedder, mem, shelf, shop } from './testing.ts'

let text = fields(shop)
type Db = ReturnType<typeof shelf>
let count = (db: Db) =>
  Number(db.query(`select count(*) as n from "${TABLE}"`, [])[0].n)
let has = (db: Db, eid: string) => !!vectorOf(db, eid, embedder.model)
let swept = async (db: Db, e: Embedder = embedder, limit?: number) => {
  let { fresh, left } = await sweep(db, text, e, limit)
  return { fresh, left }
}
let stocked = async () => {
  let db = shelf()
  await sweep(db, text, embedder)
  return db
}

Deno.test('an entity gets one text, joined from every field it wears', () => {
  let one = sources(shelf(), text).find((s) => s.entity == 'book-1')!
  assertEquals(
    one.text,
    'The Hobbit\nA burglar leaves home and meets a dragon.',
  )
  assertEquals(one.had, null)
})

Deno.test('a review is its own entity, not part of the book it is about', () => {
  let all = sources(shelf(), text)
  assertEquals(all.length, 4)
  assert(all.find((s) => s.entity == 'review-4')!.text.includes('chapters'))
})

Deno.test('a field read through an override is read as what it stands for', () => {
  let loud = text.map((f) =>
    f.prop == 'blurb' ? { ...f, text: (s: Expr) => fn('upper', s) } : f
  )
  let one = sources(shelf(), loud).find((s) => s.entity == 'book-1')!
  assert(one.text.endsWith('MEETS A DRAGON.'), one.text)
})

Deno.test('the sweep embeds everything owed, then nothing', async () => {
  let db = shelf()
  assertEquals(await swept(db), { fresh: 4, left: 0 })
  assertEquals(await swept(db), { fresh: 0, left: 0 })
  assert(has(db, 'book-1'))
})

Deno.test('a limit takes the newest and says what is left', async () => {
  let db = shelf()
  assertEquals(await swept(db, embedder, 3), { fresh: 3, left: 1 })
  assert(!has(db, 'book-1') && has(db, 'review-4'))
  assertEquals(await swept(db), { fresh: 1, left: 0 })
})

Deno.test('a write from anywhere is owed a look; unchanged text is not re-embedded', async () => {
  let db = await stocked()
  db.query(`update book set blurb = ? where entity = 1`, ['A cook, actually.'])
  db.query(`update review set prose = prose where entity = 4`, [])
  assertEquals(left(db), 2)
  assertEquals(await swept(db), { fresh: 1, left: 0 })
})

Deno.test('a new model re-embeds the whole corpus, once', async () => {
  let db = await stocked()
  let other = hashEmbedder(32)
  assertEquals(await swept(db, other), { fresh: 4, left: 0 })
  assertEquals(await swept(db, other), { fresh: 0, left: 0 })
})

Deno.test('emptied, deleted and undressed entities lose their vectors', async () => {
  let db = await stocked()
  db.query(`update book set title = ?, blurb = ? where entity = 3`, ['', '  '])
  db.exec(`insert into tombstone values (2, '2026-01-01T00:00:00Z')`)
  db.exec(`delete from review where entity = 4`)
  await swept(db)
  assertEquals(count(db), 1)
  assert(has(db, 'book-1'))
})

Deno.test('a restored entity, and a vector deleted by hand, are made again', async () => {
  let db = await stocked()
  db.exec(`insert into tombstone values (2, '2026-01-01T00:00:00Z')`)
  await swept(db)
  db.exec(`delete from tombstone where entity = 2`)
  db.exec(`delete from "${TABLE}" where entity = 1`)
  assertEquals(await swept(db), { fresh: 2, left: 0 })
  assertEquals(count(db), 4)
})

Deno.test('the vectors are derived: drop the table and the sweep rebuilds it', async () => {
  let db = await stocked()
  db.exec(`drop table "${TABLE}"`)
  for (let stmt of schema()) db.exec(stmt)
  assertEquals(await swept(db), { fresh: 4, left: 0 })
})

Deno.test('the fields changing queues everything, once', async () => {
  let db = await stocked()
  let titles = fields(shop, (c) => c.prop == 'title')
  assertEquals(watch(db, titles), true)
  assertEquals(watch(db, titles), false)
  let got = await sweep(db, titles, embedder)
  // the review wears no title now: its vector goes
  assertEquals([got.fresh, count(db)], [3, 3])
})

Deno.test('an embedder that cannot be reached keeps everything owed', async () => {
  let db = shelf()
  let down: Embedder = {
    model: embedder.model,
    embed: () => Promise.reject(new Error('no route to host')),
  }
  await assertRejects(() => sweep(db, text, down), Error, 'no route')
  assertEquals(count(db), 0)
  assertEquals(await swept(db), { fresh: 4, left: 0 })
})

Deno.test('a text the model refuses is dropped; the batch it rode in is not', async () => {
  let db = shelf()
  // a server that refuses a whole request for one input in it
  let asked = 0
  let picky = remote({
    via: 'ollama',
    model: embedder.model,
    base: 'http://box',
    fetch: (_, init) => {
      asked++
      let input: string[] = JSON.parse(init!.body!).input
      let bad = input.some((t) => t.includes('Kitchen'))
      let body = { embeddings: input.map(() => [1, 0]) }
      return Promise.resolve({
        ok: !bad,
        status: bad ? 400 : 200,
        text: () => Promise.resolve(bad ? 'too spicy' : JSON.stringify(body)),
      })
    },
  })
  let got = await sweep(db, text, picky)
  assertEquals([got.fresh, got.left, asked], [3, 0, 5])
  assertEquals(got.refused.map((r) => r.entity), ['book-3'])
  assert(got.refused[0].error instanceof Refused)
  assert(!has(db, 'book-3'))
})

Deno.test('a vocabulary with nothing to embed sweeps to nothing', async () => {
  let db = shelf()
  assertEquals(await sweep(db, [], embedder), {
    fresh: 0,
    left: 0,
    refused: [],
  })
  assertEquals(count(db), 0)
})

// Text an entity is found by through another component: an excerpt is found
// by the words on its page, and a receipt, which has a page too, is not.
let desk = loadVocab({
  $defs: {
    entity: { component: true, type: 'object', properties: {} },
    page: {
      component: true,
      type: 'object',
      properties: { words: { type: 'string' } },
    },
    excerpt: {
      component: true,
      type: 'object',
      search: ['page.words'],
      properties: { from: { type: 'string' } },
    },
  },
})

Deno.test('text found through another component counts only while that one is worn', async () => {
  let db = mem()
  for (
    let stmt of [
      `create table entity (id integer primary key, eid text not null unique)`,
      `create table tombstone (entity integer primary key, deleted_at text)`,
      `create table page (entity integer primary key, words text)`,
      `create table excerpt (entity integer primary key, "from" text)`,
      ...schema(),
    ]
  ) db.exec(stmt)
  let on = fields(desk, searched)
  assertEquals(on, [{ comp: 'page', prop: 'words', on: 'excerpt' }])
  let put = (id: number, ...rows: string[]) => {
    db.exec(`insert into entity values (${id}, 'e-${id}')`)
    for (let r of rows) db.exec(r.replaceAll('$', String(id)))
  }
  let page = `insert into page values ($, 'the dragon woke')`
  let excerpt = `insert into excerpt values ($, 'book-1')`
  put(1, page, excerpt)
  put(2, page) // a receipt
  let pass = async () => (await sweep(db, on, embedder)).fresh
  assertEquals(await pass(), 1)
  put(3, excerpt, page) // the other order
  db.exec(`insert into excerpt values (2, 'book-2')`)
  assertEquals(await pass(), 2)
  db.exec(`delete from excerpt where entity = 1`)
  await pass()
  assertEquals(
    db.query(`select entity from "${TABLE}" order by entity`, [])
      .map((r) => r.entity),
    [2, 3],
  )
})
