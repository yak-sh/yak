// The installed native exact scan ranks current stored vectors, not a stale
// index, and keeps the unindexed filtered search's semantics intact.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { among, col, render, select, table, val } from '@yaks/sql'
import { bury } from '../sqlite/testing.ts'
import { install } from './native.ts'
import { nearest, vectorOf } from './near.ts'
import { embedder, stocked } from './testing.ts'

test('native scan ranks live vectors and excludes graves', async () => {
  let db = await stocked()
  let query = vectorOf(db, 'book-1', embedder.model)!
  let expected = nearest(db, query, {
    model: embedder.model,
    limit: 3,
    without: 'book-1',
  })
  install(db)
  let found = nearest(db, query, {
    model: embedder.model,
    limit: 3,
    without: 'book-1',
  })
  assertEquals(found.map((r) => r.entity), expected.map((r) => r.entity))
  for (let i = 0; i < found.length; i++) {
    assert(Math.abs(found[i].similarity - expected[i].similarity) < 0.001)
  }
  bury(db, 2)
  assert(
    !nearest(db, query, { model: embedder.model, limit: 1, without: 'book-1' })
      .some((r) => r.entity == 'book-2'),
  )
})

test('native top-k never intersects a screen after ranking', async () => {
  let db = await stocked()
  install(db)
  let query = vectorOf(db, 'book-1', embedder.model)!
  let within = render(
    select({
      cols: [col('eid')],
      from: table('entity'),
      where: among(col('eid'), [val('book-3')]),
    }),
  )
  assertEquals(
    nearest(db, query, { model: embedder.model, limit: 1, within }).map((r) =>
      r.entity
    ),
    ['book-3'],
  )
})

test('a connection starts on JS and switches after explicit install', async () => {
  let db = await stocked()
  let query = vectorOf(db, 'book-1', embedder.model)!
  nearest(db, query, { model: embedder.model, limit: 1 })
  install(db)
  let seen = 0
  let ranker = {
    ...db,
    query: (s: Parameters<typeof db.query>[0]) => {
      let text = JSON.stringify(s)
      if (text.includes('vector_full_scan')) seen++
      return db.query(s)
    },
  }
  nearest(ranker, query, { model: embedder.model, limit: 1 })
  assertEquals(seen, 1)
})
