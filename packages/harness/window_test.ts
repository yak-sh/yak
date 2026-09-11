import { assert, assertEquals } from '@std/assert'
import { open } from './store.ts'
import { remote } from './remote.ts'
import { transcriptWindow } from '@yaks/session'

Deno.test('SQLite fork window reads limited bodies and projects position metadata', async () => {
  let h = open(':memory:')
  try {
    await h.g.apply([
      { entity: { eid: 'p' }, session: {} },
      ...Array.from({ length: 2000 }, (_, i) => ({
        entity: { eid: 'p' + i },
        entry: { session: 'p', seq: i + 1 },
        content: { body: String(i) + 'x'.repeat(1000) },
      })),
    ])
    let queries: string[] = [], read = h.g.read.bind(h.g)
    h.g.read = ((q, opts) => {
      queries.push(q as string)
      return read(q, opts)
    }) as typeof h.g.read
    let page = await transcriptWindow(h.g, 'p', { limit: 32 })
    assertEquals(page.entries.length, 32)
    assertEquals(page.entries[0].entity.eid, 'p1968')
    assert(
      queries.every((q) => q.includes('.fields=') || q.includes('.limit=32')),
    )
  } finally {
    h.close()
  }
})

Deno.test('worker pages retained graph data and keeps initial transfer independent of transcript length', async () => {
  let dir = await Deno.makeTempDir(), path = dir + '/db.sqlite'
  let h = open(path)
  await h.g.apply([
    { entity: { eid: 's' }, session: {} },
    ...Array.from({ length: 300 }, (_, i) => ({
      entity: { eid: 'entry' + i },
      entry: { session: 's', seq: i + 1 },
      content: { body: String(i) + 'x'.repeat(10000) },
    })),
  ])
  h.close()
  let r = await remote({ db: path, cwd: dir, fake: true })
  try {
    let page = await r.agent.transcriptWindow!('s', { limit: 16 })
    assertEquals(page.entries.length, 16)
    assertEquals(page.entries[0].entity.eid, 'entry284')
    assertEquals([page.before, page.after], [true, false])
    assert(!r.replica.ent('entry0'))
    assertEquals(
      (r.replica.ent('entry299')!.content as { body: string }).body.length,
      10003,
    )
    let middle = await r.agent.transcriptWindow!('s', {
      anchor: 'entry150',
      limit: 16,
    })
    assertEquals(middle.entries[0].entity.eid, 'entry142')
    assert(!r.replica.ent('entry299')?.content)
    let [head, tail] = await Promise.all([
      r.agent.transcriptWindow!('s', { edge: 'start', limit: 8 }),
      r.agent.transcriptWindow!('s', { edge: 'end', limit: 8 }),
    ])
    assertEquals(head.entries[0].entity.eid, 'entry0')
    assertEquals(tail.entries.at(-1)!.entity.eid, 'entry299')
    assert(!r.replica.ent('entry150')?.content)
    await r.agent.send('s', 'new message')
    await r.idle('s')
    let end = await r.agent.transcriptWindow!('s', { limit: 16 })
    assert(
      end.entries.some((b) =>
        (b.content as { body?: string })?.body == 'new message'
      ),
    )
    assertEquals(end.after, false)
  } finally {
    await r.close()
    await Deno.remove(dir, { recursive: true })
  }
})
