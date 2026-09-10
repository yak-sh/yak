import { assertEquals, assertRejects } from '@std/assert'
import { appendEntry, repairSequences } from './append.ts'
import { locked, seed, store } from './harness.ts'
import { transcript } from './react.ts'
import type { Bundle, Comp } from '@yaks/graph'

let positions = (rows: Bundle[]) => rows.map((b) => (b.entry as Comp).seq)

Deno.test('concurrent append and passive notices receive integer sequence positions', async () => {
  let g = locked(store())
  await g.apply([{ entity: { eid: 's' }, session: {} }])
  await Promise.all(
    Array.from(
      { length: 20 },
      (_, i) =>
        appendEntry(g, 's', 'line ' + i, { eid: 'e' + i, notice: true }),
    ),
  )
  assertEquals(
    positions(await transcript(g, 's')),
    Array.from({ length: 20 }, (_, i) => i + 1),
  )
  await appendEntry(g, 's', 'same', { eid: 'e0', notice: true })
  assertEquals(
    positions(await transcript(g, 's')),
    Array.from({ length: 20 }, (_, i) => i + 1),
  )
  await assertRejects(
    async () => {
      await g.apply([{
        entity: { eid: 'fraction' },
        entry: { session: 's', seq: 20.5 },
      }])
    },
    Error,
    'positive integer',
  )
  await assertRejects(
    async () => {
      await g.apply([{
        entity: { eid: 'duplicate' },
        entry: { session: 's', seq: 2 },
      }])
    },
    Error,
    'occupied',
  )
  await assertRejects(
    async () => {
      await g.apply([{ entity: { eid: 'e0' }, entry: { seq: 3.5 } }])
    },
    Error,
    'positive integer',
  )
})

Deno.test('repair preserves nested fork prefix IDs and order, then append starts after boundary', async () => {
  let s = store()
  seed(
    s,
    { entity: { eid: 'parent' }, session: {} },
    { entity: { eid: 'a' }, entry: { session: 'parent', seq: 1 } },
    { entity: { eid: 'b' }, entry: { session: 'parent', seq: 1.875 } },
    { entity: { eid: 'c' }, entry: { session: 'parent', seq: 2.875 } },
    { entity: { eid: 'child' }, session: {}, fork: { from: 'b' } },
    { entity: { eid: 'd' }, entry: { session: 'child', seq: 2.875 } },
    { entity: { eid: 'grand' }, session: {}, fork: { from: 'd' } },
    { entity: { eid: 'e' }, entry: { session: 'grand', seq: 3.875 } },
  )
  let g = locked(s)
  let before = (await transcript(g, 'grand')).map((b) => b.entity.eid)
  assertEquals(await s.tx(repairSequences), 4)
  assertEquals(await s.tx(repairSequences), 0)
  assertEquals((await transcript(g, 'grand')).map((b) => b.entity.eid), before)
  assertEquals(positions(await transcript(g, 'grand')), [1, 2, 3, 4])
  await appendEntry(g, 'grand', 'next')
  assertEquals(positions(await transcript(g, 'grand')), [1, 2, 3, 4, 5])
  await g.apply([{
    entity: { eid: 'new-child' },
    session: {},
    fork: { from: 'd' },
  }, {
    entity: { eid: 'new-input' },
    entry: { session: 'new-child' },
    content: { body: 'new' },
  }])
  assertEquals(positions(await transcript(g, 'new-child')), [1, 2, 3, 4])
})

Deno.test('batch reservations reject duplicate explicit entries and rollback', async () => {
  let g = locked(store())
  await g.apply([{ entity: { eid: 's' }, session: {} }])
  await assertRejects(
    async () => {
      await g.apply([
        { entity: { eid: 'a' }, entry: { session: 's', seq: 1 } },
        { entity: { eid: 'b' }, entry: { session: 's', seq: 1 } },
      ])
    },
    Error,
    'occupied',
  )
  assertEquals(await transcript(g, 's'), [])
})

Deno.test('batch child-before-parent order still allocates after the new fork anchor', async () => {
  let g = locked(store())
  await g.apply([
    { entity: { eid: 'child' }, session: {}, fork: { from: 'anchor' } },
    { entity: { eid: 'child-input' }, entry: { session: 'child' } },
    { entity: { eid: 'parent' }, session: {} },
    { entity: { eid: 'anchor' }, entry: { session: 'parent' } },
  ])
  assertEquals(positions(await transcript(g, 'child')), [1, 2])
  await assertRejects(
    async () => {
      await g.apply([{ entity: { eid: 'anchor' }, entry: { seq: 4 } }])
    },
    Error,
    'cannot move',
  )
})

Deno.test('notice tool admits passive context without callers supplying sequence', async () => {
  let g = locked(store())
  await g.apply([{ entity: { eid: 's' }, session: {} }])
  let { sessionTools } = await import('./children.ts')
  let tool = sessionTools(g).find((t) => t.name == 'notice')!
  let id = await tool.run({ session: 's', body: 'background', eid: 'note' }, {
    session: 's',
    call: { entity: { eid: 'tool-call' } },
    entries: [],
  })
  assertEquals(id, 'note')
  let rows = await transcript(g, 's')
  assertEquals(positions(rows), [1])
  assertEquals(rows[0].notice, {})
})

Deno.test('repair refuses ambiguous historical ties instead of changing fork boundaries', async () => {
  let s = store()
  seed(s, { entity: { eid: 's' }, session: {} }, {
    entity: { eid: 'a' },
    entry: { session: 's', seq: 1.5 },
  }, { entity: { eid: 'b' }, entry: { session: 's', seq: 1.5 } })
  await assertRejects(
    async () => {
      await s.tx(repairSequences)
    },
    Error,
    'ambiguous duplicate',
  )
})
