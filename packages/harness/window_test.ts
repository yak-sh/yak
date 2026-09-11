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
    assert(r.replica.cache.size() <= 256)
    let [head, tail] = await Promise.all([
      r.agent.transcriptWindow!('s', { edge: 'start', limit: 8 }),
      r.agent.transcriptWindow!('s', { edge: 'end', limit: 8 }),
    ])
    assertEquals(head.entries[0].entity.eid, 'entry0')
    assertEquals(tail.entries.at(-1)!.entity.eid, 'entry299')
    assert(r.replica.cache.size() <= 256)
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

Deno.test('mounted bounded transcript navigates beyond loaded edges and restores a detached session anchor', async () => {
  const { h: element } = await import('preact')
  const { mount } = await import('../tui/harness.ts')
  const { pressTo } = await import('../tui/screen.ts')
  const { App } = await import('./app.ts')
  const { frontend } = await import('./frontend.ts')
  const { until } = await import('../process/harness.ts')
  let store = open(':memory:')
  await store.g.apply([
    { entity: { eid: 's' }, session: {} },
    { entity: { eid: 'other' }, session: {} },
    ...Array.from({ length: 500 }, (_, i) => ({
      entity: { eid: 'e' + i },
      entry: { session: 's', seq: i + 1 },
      content: { body: 'line ' + i },
    })),
  ])
  let ui = frontend(), read = 0, maximum = 0
  ui.patch({ selected: 's' })
  let a: import('./panels.ts').UIAgent = {
    start: async () => 's',
    send: async () => 'sent',
    taskEntry: async () => ({ task: 't', child: 'c' }),
    sessions: () =>
      Promise.resolve([{ entity: { eid: 's' }, session: { id: 'Session' } }, {
        entity: { eid: 'other' },
        session: { id: 'Other' },
      }]),
    usage: async () => [],
    children: async () => [],
    tasks: async () => [],
    transcript: () => {
      throw new Error('full transcript must not load')
    },
    transcriptWindow: async (session, options) => {
      read++
      let page = await transcriptWindow(store.g, session, options)
      maximum = Math.max(maximum, page.entries.length)
      return page
    },
    line: () => '',
    entry: (b) =>
      element('div', null, String((b.content as { body: string }).body)),
  }
  let screen = await mount(
    () => element(App, { agent: a, frontend: ui, subscribe: () => () => {} }),
    80,
    12,
  )
  let selected = () =>
    (ui.client.ent('viewport-s')?.viewport as { selected?: string })?.selected
  try {
    await until(
      () => screen.text().includes('line 499'),
      'initial bounded tail',
    )
    assert(maximum <= 64)
    let beforeTyping = read
    await screen.send('draft')
    assertEquals(read, beforeTyping)
    // Jump to real start, not just the first item in the loaded tail window.
    pressTo('transcript-s', { name: 'home' })
    await until(() => /line 0 +[│█]/.test(screen.text()), 'bounded start')
    pressTo('transcript-s', { name: 'down' })
    for (let i = 0; i < 90; i++) {
      pressTo('transcript-s', { name: 'down' })
      await screen.resize(80, 12)
      // Let asynchronous range admission complete without timing sleeps.
      for (let j = 0; j < 30; j++) await Promise.resolve()
    }
    await until(
      () => Number(selected()?.slice(1)) > 64,
      'selection crosses initial page',
    )
    let anchor = {
      ...(ui.client.ent('viewport-s')!.viewport as Record<string, unknown>),
    }
    ui.patch({ selected: 'other', generation: 1 })
    await until(
      () => screen.text().includes('Harness — other'),
      'other session',
    )
    ui.patch({ selected: 's', generation: 2 })
    await until(
      () => screen.text().includes('line ' + String(anchor.selected).slice(1)),
      'return to detached entry',
    )
    pressTo('transcript-s', { name: 'end' })
    await until(() => screen.text().includes('line 499'), 'jump to actual end')
    assertEquals(
      (ui.client.ent('viewport-s')!.viewport as { follow: boolean }).follow,
      true,
    )
    assert(maximum <= 64)
  } finally {
    screen.free()
    ui.close()
    store.close()
  }
})

Deno.test('usage panel reads latest inherited ask metadata without transcript bodies', async () => {
  const { transcriptUsage } = await import('@yaks/session')
  let store = open(':memory:')
  try {
    await store.g.apply([
      { entity: { eid: 'p' }, session: {} },
      { entity: { eid: 'm' }, model: { name: 'test' } },
      {
        entity: { eid: 'input' },
        entry: { session: 'p', seq: 1 },
        content: { body: 'old'.repeat(10000) },
      },
      {
        entity: { eid: 'ask' },
        entry: { session: 'p', seq: 2 },
        ask: { to: 'm', through: 'input' },
        usage: { input_tokens: 42 },
      },
      { entity: { eid: 'c' }, session: {}, fork: { from: 'ask' } },
      {
        entity: { eid: 'later' },
        entry: { session: 'p', seq: 3 },
        ask: { to: 'm', through: 'ask' },
        usage: { input_tokens: 99 },
      },
    ])
    let rows = await transcriptUsage(store.g, 'c')
    assertEquals(rows.length, 1)
    assertEquals(rows[0].entity.eid, 'ask')
    assertEquals((rows[0].usage as { input_tokens: number }).input_tokens, 42)
    assert(!rows[0].content)
  } finally {
    store.close()
  }
})
