// The asynchronous ranking door pages by entity NUMBER, not spine id or rank
// position. Keep the provider out of this contract: it receives a neighbourhood
// bound, and askRows takes the requested page within that ranking.
import { applyNumbered } from './testdb.ts'
import { assertEquals } from '@std/assert'
import { askOf, askRows, NEIGHBOURS, rowed, setRanker } from './graph_query.ts'
import { uuid } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let { rowsOf } = await import('./db.ts')
let { bareDb } = await import('./testdb.ts')
let db = bareDb()
let eids = Array.from({ length: 4 }, () => uuid())
applyNumbered(
  db,
  eids.map((eid, i) => ({
    eid,
    name: 'doc',
    comp: { title: `rank ${i}`, body: `body ${i}` },
  })),
)
let rows = new Map(rowsOf(db, eids).map((r) => [r.eid, rowed(r)]))
// Neither spine order nor its reverse: comparing nums instead of locating the
// anchor in the ranking must fail. Bodies also mint unnumbered blob entities.
let ranked = [2, 0, 3, 1].map((i) => rows.get(eids[i])!)
let bounds: (number | undefined)[] = []
setRanker((_db, _asked, limit) => {
  bounds.push(limit)
  return Promise.resolve(ranked.slice(0, limit))
})
let query = [`.near=${eids[0]}`, '.order=similar']
let ids = (hits: typeof ranked) => hits.map((r) => r.eid)

Deno.test('similarity window: the cursor names an entity inside the ranking', async () => {
  let first = await askRows(db, askOf([...query, '.limit=2']))
  assertEquals(ids(first), ids(ranked.slice(0, 2)))
  assertEquals(bounds.at(-1), 2)
  let next = await askRows(
    db,
    askOf([...query, '.limit=2', `.after=${first[1].num}`]),
  )
  assertEquals(ids(next), ids(ranked.slice(2)))
  assertEquals(bounds.at(-1), NEIGHBOURS)
  assertEquals(ids([...first, ...next]), ids(ranked))
})

Deno.test('similarity window: missing anchor restarts; final anchor exhausts', async () => {
  assertEquals(
    ids(await askRows(db, askOf([...query, '.after=999999', '.limit=2']))),
    ids(ranked.slice(0, 2)),
  )
  assertEquals(bounds.at(-1), NEIGHBOURS)
  assertEquals(
    await askRows(db, askOf([...query, `.after=${ranked[3].num}`, '.limit=2'])),
    [],
  )
})

Deno.test('similarity window: door bounds override the line; zero is no cursor', async () => {
  assertEquals(
    ids(
      await askRows(
        db,
        askOf([
          ...query,
          '.limit=3',
          `.after=${ranked[0].num}`,
          'limit=1',
          `after=${ranked[1].num}`,
        ]),
      ),
    ),
    ids(ranked.slice(2, 3)),
  )
  assertEquals(bounds.at(-1), NEIGHBOURS)
  assertEquals(
    ids(await askRows(db, askOf([...query, '.after=0', '.limit=1']))),
    ids(ranked.slice(0, 1)),
  )
  assertEquals(bounds.at(-1), 1)
  assertEquals(
    ids(
      await askRows(
        db,
        askOf([
          ...query,
          `.after=${ranked[1].num}`,
          '.limit=1',
          'after=0',
        ]),
      ),
    ),
    ids(ranked.slice(0, 1)),
  )
  assertEquals(bounds.at(-1), 1)
})
