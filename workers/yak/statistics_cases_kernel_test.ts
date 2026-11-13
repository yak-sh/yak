// A deploy's planner statistics are the Store's alarm to work off, never the
// deploying request's. How they are owed, adopted and kept across
// incarnations is the object's edge (@yaks/durable-object
// incarnation_test.ts).
import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { driver } from '@yaks/durable-object'
import { by, catalogue, scan } from '@yaks/sql'
import { state } from './testing.ts'
import { Store } from './graph.ts'

test('a deploy leaves the statistics of its new index to the alarm', async () => {
  let ctx = state()
  let store = new Store(ctx, {}, [])
  let send = async (path: string, body: unknown) => {
    let res = await store.fetch(
      new Request(`https://store${path}`, {
        method: 'POST',
        headers: {
          'x-store': 'probe/statistics',
          'x-yak-access': 'private',
          'x-yak-role': 'owner',
          'x-yak-kernel': '1',
        },
        body: JSON.stringify(body),
      }),
    )
    if (!res.ok) throw new Error(await res.text())
    await res.body?.cancel()
  }
  let words = (index: boolean) => ({
    $defs: {
      recipe: {
        component: true,
        properties: { rating: { type: 'number', index } },
      },
    },
  })
  // Whether the planner has statistics for the recipe index: none at all
  // before an analysis has made the table that holds them.
  let indexed = () => {
    let d = driver(ctx.storage)
    return catalogue(d).some((o) => o.name == 'sqlite_stat1') &&
      scan(d, 'sqlite_stat1', by({ tbl: 'recipe' }), ['idx'])
        .some((row) => row.idx != null)
  }
  await send('/vocab', words(false))
  await send('/apply', [
    { entity: { eid: 'one' }, recipe: { rating: 1 } },
    { entity: { eid: 'two' }, recipe: { rating: 2 } },
  ])
  await send('/vocab', words(true))
  let deployed = indexed()
  await store.alarm()
  assertEquals([deployed, indexed()], [false, true])
  await ctx.storage.deleteAlarm?.()
})
