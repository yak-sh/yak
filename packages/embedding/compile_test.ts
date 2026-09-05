// The whole query path: `.near` selects a neighbourhood, `.order=similar` puts
// it in order, the rest of the line still filters, and the similarity comes
// back as a component.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { parse } from '@yaks/query'
import { compile, Unsupported } from '@yaks/sql'
import type { Bundle } from '@yaks/graph'
import { semantic } from './compile.ts'
import type { Driver } from './driver.ts'
import { embedder, shop, stocked } from './harness.ts'

// The eids a query selects, in the order the statement yields them.
let ask = (db: Driver, q: string, ext: ReturnType<typeof semantic>) => {
  let { sql, params } = compile(parse(q), shop, { extend: [ext] })
  return db.query(sql, params).map((r) => String(r.eid))
}

Deno.test('.near selects the neighbourhood and nothing else', async () => {
  let db = await stocked()
  let near = semantic(db, embedder, { limit: 2 })
  let got = ask(db, '.near=book-1', near)
  assertEquals(got.length, 2)
  assert(!got.includes('book-1'), 'an entity is not its own neighbour')
  assert(got.includes('book-2'))
})

Deno.test('.order=similar puts the neighbourhood in order', async () => {
  let db = await stocked()
  let near = semantic(db, embedder)
  let got = ask(db, '.near=book-1&.order=similar', near)
  assertEquals(got, near.neighbours().map((n) => n.entity))
  assertEquals(got[0], 'book-2')
  // and the ordering reverses like any other
  let down = ask(db, '.near=book-1&.order=-similar', near)
  assertEquals(down, [...got].reverse())
})

// The cursor is the ordinary `.after=<num>`: a caller pages a neighbourhood the
// way it pages a board, and never learns that the sort key is a similarity. The
// binder asks this extension's `order` hook a second time with the anchor's
// owner id, so a rank position is derived rather than spelled.
Deno.test('a window pages within the neighbourhood, nearest first', async () => {
  let db = await stocked()
  let near = semantic(db, embedder)
  let all = ask(db, '.near=book-1&.order=similar', near)
  assert(all.length >= 3, `${all}`)
  let num = (eid: string) => Number(eid.split('-')[1])
  assertEquals(ask(db, '.near=book-1&.order=similar&.limit=1', near), [all[0]])
  assertEquals(
    ask(db, `.near=book-1&.order=similar&.limit=1&.after=${num(all[0])}`, near),
    [all[1]],
  )
  assertEquals(
    ask(db, `.near=book-1&.order=similar&.after=${num(all[1])}`, near),
    all.slice(2),
  )
})

Deno.test('the rest of the query line still filters', async () => {
  let db = await stocked()
  let near = semantic(db, embedder)
  assertEquals(ask(db, '.near=book-1&.price<15&.order=similar', near), [
    'book-3',
  ])
  assertEquals(ask(db, '.near=book-1&.kind=review', near), ['review-4'])
})

Deno.test('the ranking is compiled, not bound — no params in the order', async () => {
  let db = await stocked()
  let { sql, params } = compile(
    parse('.near=book-1&.order=similar'),
    shop,
    { extend: [semantic(db, embedder)] },
  )
  let [, order] = sql.split(' order by ')
  assert(order.startsWith('case "entity"."id" when '), order)
  assert(!order.includes('?'), order)
  // every value the statement does bind is an integer id, never text
  assert(params.every((p) => typeof p == 'number'), `${params}`)
})

Deno.test('an anchor with no vector selects nothing, never everything', async () => {
  let db = await stocked()
  let near = semantic(db, embedder)
  assertEquals(ask(db, '.near=nobody', near), [])
  assertEquals(near.neighbours(), [])
})

Deno.test('a floor can leave the neighbourhood empty', async () => {
  let db = await stocked()
  let near = semantic(db, embedder, { floor: 0.99 })
  assertEquals(ask(db, '.near=book-1&.order=similar', near), [])
})

Deno.test('the similarity rides back as a query-only comp', async () => {
  let db = await stocked()
  let near = semantic(db, embedder)
  ask(db, '.near=book-1&.order=similar', near)
  let bundles: Bundle[] = near.neighbours()
    .map((n) => ({ entity: { eid: n.entity } }))
    .reverse()
  let ranked = near.rank(bundles)
  assertEquals(
    ranked.map((b) => b.entity.eid),
    near.neighbours().map((n) => n.entity),
  )
  let top = ranked[0].rank as { score: number }
  assertEquals(top.score, near.neighbours()[0].similarity)
  // a bundle the neighbourhood does not name keeps its shape and sorts last
  let mixed = near.rank([{ entity: { eid: 'book-9' } }, ...bundles])
  assertEquals(mixed[mixed.length - 1], { entity: { eid: 'book-9' } })
})

Deno.test('without this extension the compiler still declines .near', async () => {
  let db = await stocked()
  assertThrows(() => compile(parse('.near=book-1'), shop), Unsupported, '.near')
  // and an ordering with no anchor to rank by declines too
  assertThrows(
    () =>
      compile(parse('.order=similar'), shop, {
        extend: [semantic(db, embedder)],
      }),
    Unsupported,
    'nothing to rank by',
  )
})
