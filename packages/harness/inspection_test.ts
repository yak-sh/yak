import { assert, assertEquals, assertRejects } from '@std/assert'
import { open } from './store.ts'
import { inspection } from './inspection.ts'

Deno.test('inspection searches a fork prefix in bounded pages and reads exact Unicode source', async () => {
  const h = open(':memory:')
  try {
    await h.g.apply([
      { entity: { eid: 'p' }, session: { id: 'parent' } },
      {
        entity: { eid: 'a' },
        entry: { session: 'p' },
        content: { body: '🌲first needle\nneedle' },
      },
      {
        entity: { eid: 'outside' },
        entry: { session: 'p' },
        content: { body: 'needle outside fork' },
      },
      { entity: { eid: 'c' }, session: { id: 'child' }, fork: { from: 'a' } },
      {
        entity: { eid: 'own' },
        entry: { session: 'c' },
        content: { body: 'needle '.repeat(45) },
      },
    ])
    const api = inspection(h.g)
    const first = await api.search('c', 'needle')
    assertEquals(first.matches.length, 20)
    assertEquals(first.matches[0].offset, 7)
    assert(!first.matches.some((m) => m.entity == 'outside'))
    const second = await api.search('c', 'needle', first.next!)
    assertEquals(second.matches.length, 20)
    const third = await api.search('c', 'needle', second.next!)
    assertEquals(third.matches.length, 7)
    const page = await api.inspect('c', 'a')
    assertEquals(page.text, '🌲first needle\nneedle')
    await h.g.apply([{ entity: { eid: 'a' }, content: { body: 'changed' } }])
    await assertRejects(
      () => api.inspect('c', 'a', 0, page.revision),
      Error,
      'revision changed',
    )
    await assertRejects(() => api.inspect('c', 'outside'), Error, 'outside')
  } finally {
    h.close()
  }
})

Deno.test('search bounds no-match scanning and detail responses', async () => {
  const h = open(':memory:')
  try {
    await h.g.apply([
      { entity: { eid: 'p' }, session: { id: 'p' } },
      ...Array.from(
        { length: 80 },
        (_, i) => ({
          entity: { eid: 'e' + i },
          entry: { session: 'p' },
          content: { body: i == 79 ? 'found' : 'absent' },
        }),
      ),
      {
        entity: { eid: 'huge' },
        entry: { session: 'p' },
        prompt: { scope: 'shared' },
        content: { body: 'x'.repeat(100000) },
      },
    ])
    const api = inspection(h.g)
    const page = await api.search('p', 'found')
    assertEquals(page.matches, [])
    assert(page.next)
    assertEquals(
      (await api.search('p', 'found', page.next)).matches[0].entity,
      'e79',
    )
    const detail = await api.inspect('p', 'huge')
    assertEquals(detail.text.length, 4096)
    assertEquals(detail.total, 100000)
    assertEquals(detail.next, 4096)
    await assertRejects(() => api.search('p', ''), Error, '1–256')
    assertEquals((await api.search('p', '.*')).matches, [])
  } finally {
    h.close()
  }
})

Deno.test('inspection exposes metadata for entries without prose and supports worker transport', async () => {
  const { remote } = await import('./remote.ts')
  const dir = await Deno.makeTempDir()
  const r = await remote({ db: ':memory:', cwd: dir, fake: true })
  try {
    const session = await r.agent.start('Find this needle')
    await r.idle(session)
    const page = await r.agent.search!(session, 'needle')
    assertEquals(page.matches.length, 1)
    const source = await r.agent.inspect!(session, page.matches[0].entity)
    assertEquals(source.text, 'Find this needle')
    const entries = await r.agent.transcript(session)
    const ask = entries.find((b) => b.ask)!
    const metadata = await r.agent.inspect!(session, ask.entity.eid)
    assert(metadata.entry.ask)
    assert(metadata.text.includes('"ask"'))
  } finally {
    await r.close()
    await Deno.remove(dir, { recursive: true })
  }
})
