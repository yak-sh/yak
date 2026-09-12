import { assert, assertEquals, assertRejects } from '@std/assert'
import { entrySource, SOURCE_LIMIT } from './detail.ts'
import { open } from './store.ts'
import { remote } from './remote.ts'

const seed = [
  { entity: { eid: 'p' }, session: {} },
  {
    entity: { eid: 'a' },
    entry: { session: 'p', seq: 1 },
    content: { body: '🙂'.repeat(5000) },
  },
  {
    entity: { eid: 'late' },
    entry: { session: 'p', seq: 2 },
    content: { body: 'secret' },
  },
  { entity: { eid: 'child' }, session: {}, fork: { from: 'a' } },
  { entity: { eid: 'other' }, session: {} },
]

Deno.test('SOURCE authorizes inherited entry without reading transcript and pages Unicode with revision', async () => {
  let h = open(':memory:')
  try {
    await h.g.apply(seed)
    let queries: string[] = [], read = h.g.read.bind(h.g)
    h.g.read = ((q, opts) => {
      queries.push(q as string)
      return read(q, opts)
    }) as typeof h.g.read
    let first = await entrySource(h.g, 'child', 'a')
    assertEquals(Array.from(first.text).length, SOURCE_LIMIT)
    assertEquals([first.start, first.end, first.next, first.total], [
      0,
      4096,
      4096,
      5000,
    ])
    let last = await entrySource(h.g, 'child', 'a', {
      start: first.next!,
      revision: first.revision,
    })
    assertEquals([last.end, last.next, Array.from(last.text).length], [
      5000,
      null,
      904,
    ])
    assert(
      queries.every((q) => q.includes('.eid=') || q.includes('.entity.eid=')),
    )
    queries.length = 0
    await assertRejects(
      () => entrySource(h.g, 'child', 'late'),
      Error,
      'not in this transcript',
    )
    assert(queries.every((q) => q.includes('.fields=')))
    await assertRejects(
      () => entrySource(h.g, 'other', 'a'),
      Error,
      'not in this transcript',
    )
    await assertRejects(() => entrySource(h.g, 'child', 'missing'))
    await assertRejects(() => entrySource(h.g, 'child', 'a', { start: -1 }))
    await h.g.apply([{ entity: { eid: 'a' }, content: { body: 'changed' } }])
    await assertRejects(
      () => entrySource(h.g, 'child', 'a', { revision: first.revision }),
      Error,
      'revision',
    )
  } finally {
    h.close()
  }
})

Deno.test('SOURCE worker fake matches inline read and rejects unrelated entries', async () => {
  let dir = await Deno.makeTempDir(), db = dir + '/db.sqlite'
  let h = open(db)
  await h.g.apply(seed)
  let expected = await entrySource(h.g, 'child', 'a')
  h.close()
  let r = await remote({ db, cwd: dir, fake: true })
  try {
    assertEquals(await r.agent.entrySource!('child', 'a'), expected)
    let next = await r.agent.entrySource!('child', 'a', {
      start: expected.next!,
      revision: expected.revision,
    })
    assertEquals(next.next, null)
    await assertRejects(
      () => r.agent.entrySource!('child', 'late'),
      Error,
      'not in this transcript',
    )
    await assertRejects(
      () => r.agent.entrySource!('child', 'a', { revision: 'wrong' }),
      Error,
      'revision',
    )
  } finally {
    await r.close()
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('SOURCE prefers full receipt and supports call arguments without searching', async () => {
  let h = open(':memory:')
  try {
    await h.g.apply([
      { entity: { eid: 's' }, session: {} },
      {
        entity: { eid: 'receipt' },
        entry: { session: 's', seq: 1 },
        content: { body: 'preview' },
        context_output: { body: 'complete receipt' },
      },
      {
        entity: { eid: 'tool' },
        entry: { session: 's', seq: 2 },
        call: { args: '{"query":"x"}' },
      },
      {
        entity: { eid: 'empty' },
        entry: { session: 's', seq: 3 },
        content: { body: '' },
      },
    ])
    assertEquals(
      (await entrySource(h.g, 's', 'receipt')).text,
      'complete receipt',
    )
    let call = await entrySource(h.g, 's', 'tool')
    assertEquals([call.component, call.property, call.text], [
      'call',
      'args',
      '{"query":"x"}',
    ])
    let empty = await entrySource(h.g, 's', 'empty')
    assertEquals([empty.text, empty.total, empty.next], ['', 0, null])
  } finally {
    h.close()
  }
})
