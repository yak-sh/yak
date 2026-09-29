import { assertEquals, assertRejects } from '@std/assert'
import { detached, graph, Stale } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { workshop } from './testing.ts'
import { candidates, sync } from './deps.ts'

Deno.test('a delayed reconciliation cannot erase a newer input dependency', async () => {
  let vocab = workshop()
  let g = graph({ storage: ram(vocab), vocab })
  await g.apply([{ entity: { eid: 'builder' }, builder: { immediate: true } }])
  let initial = await g.storage.tx((tx) =>
    sync(tx, 'builder', ['component:doc', 'entity:a'])
  )
  await g.apply(initial, { trusted: true })
  let older = await g.storage.tx((tx) =>
    sync(tx, 'builder', ['component:doc', 'entity:b'])
  )
  let newer = await g.storage.tx((tx) =>
    sync(tx, 'builder', ['component:doc', 'entity:c'])
  )
  await g.apply(newer, { trusted: true })
  await assertRejects(async () => {
    await g.apply(older, { trusted: true })
  }, Stale)
  let selected = await candidates(detached(g.storage), 'c', [])
  assertEquals(selected.map((b) => b.entity.eid), ['builder'])
  assertEquals(await candidates(detached(g.storage), 'b', []), [])
})
