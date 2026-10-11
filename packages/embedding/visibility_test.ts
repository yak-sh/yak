// A vector combines its source aspects. Hidden text must not influence a
// neighbourhood, even when the entity carrying that aspect is public.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parse } from '@yaks/query'
import {
  type BindOpts,
  by,
  col,
  compile,
  insert,
  render,
  select,
  type Statements,
  table,
} from '@yaks/sql'
import { semantic } from './compile.ts'
import { fields } from './fields.ts'
import { meaning } from './search.ts'
import { sweep } from './sweep.ts'
import { embedder, shop, stocked } from './testing.ts'
import { type Rank, vectorOf } from './near.ts'
import { cosine } from './vector.ts'

// A held ranking over the fixture's three vectors. It reads the received
// screen against SQLite, exercising the public Rank contract without a
// native-index build or a vector-table scan in each compiler test.
let ranking = (sql: Statements): Rank => {
  let all = [1, 2, 3].map((owner) => ({
    owner,
    entity: `book-${owner}`,
    vector: vectorOf(sql, `book-${owner}`, embedder.model)!,
  }))
  return (query, limit, within) => {
    let visible = within && new Set(sql.query(within).map((r) => Number(r.id)))
    return all.filter((n) => !visible || visible.has(n.owner))
      .map(({ entity, owner, vector }) => ({
        entity,
        owner,
        similarity: cosine(query, vector),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
  }
}

let db = await stocked()
db.query({ t: 'delete', from: 'review', where: by({ entity: 4 }) })
db.query(insert('review', {
  entity: 2,
  prose: 'private dragon burglar thoughts',
  stars: 5,
  book: 1,
}))
await sweep(db, fields(shop), embedder)
let near = semantic(db, embedder, { limit: 1, rank: ranking(db) })
let other = { components: { review: '.entity.eid!=book-2' } }
let ask = (anchor: string, visibility?: BindOpts['visibility']) =>
  db.query(
    compile(parse(`.entity .near=${anchor}`), shop, {
      extend: [near],
      visibility,
    }),
  ).map((r) => String(r.eid))

test('a hidden entity cannot be a semantic anchor', () => {
  assertEquals(ask('book-1', { entity: '.entity.eid!=book-1' }), [])
})

test('a public entity with hidden source text cannot be a semantic anchor', () => {
  assertEquals(ask('book-2', other), [])
})

test('semantic candidates exclude hidden source text before the limit', () => {
  assertEquals(ask('book-1', other), ['book-3'])
})

test('visible source text still participates in a semantic neighbourhood', () => {
  assertEquals(
    ask('book-1', { components: { review: '.entity.eid=book-2' } }),
    [
      'book-2',
    ],
  )
})

test('trusted semantic reads keep the full neighbourhood', () => {
  assertEquals(ask('book-1'), ['book-2'])
})

let only = render(select({
  cols: [col('id')],
  from: table('entity'),
  where: by({ eid: 'book-2' }),
}))
let vector = vectorOf(db, 'book-2', embedder.model)!
let phrase = { model: embedder.model, embed: () => vector }
let shared: Statements = { ...db, ownership: 'shared' }

test('phrase search excludes hidden sources and their excerpts', async () => {
  let opts = {
    visibility: other,
    vocab: shop,
    limit: 1,
    screen: () => only,
  }
  let hits = await meaning(shared, fields(shop), phrase, 'dragon burglar', opts)
  assertEquals(hits.some((h) => h.entity == 'book-2'), false)
  assertEquals(hits.some((h) => h.excerpt.includes('private')), false)
})

let stale = await stocked()
stale.query({ t: 'delete', from: 'review', where: by({ entity: 4 }) })
stale.query(insert('review', {
  entity: 2,
  prose: 'private dragon burglar thoughts',
  stars: 5,
  book: 1,
}))
await sweep(stale, fields(shop), embedder)
stale.query({ t: 'delete', from: 'review', where: by({ entity: 2 }) })
let staleNear = semantic(stale, embedder, { limit: 1, rank: ranking(stale) })

test('a removed private source stays excluded until its vector is reconciled', () => {
  let rows = stale.query(
    compile(parse('.entity .near=book-1'), shop, {
      extend: [staleNear],
      visibility: other,
    }),
  )
  assertEquals(rows.map((r) => String(r.eid)), ['book-3'])
})
