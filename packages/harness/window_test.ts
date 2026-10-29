import { derivedEid } from '@yaks/graph/identity'
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { identityEid } from '@yaks/graph'

import { transcriptUsage, transcriptWindow } from '@yaks/session'
import { harness } from './testing.ts'
import { h as element } from 'preact'
import { mount } from '../tui/testing.ts'
import { pressTo } from '../tui/screen.ts'
import { App } from './app.ts'
import { frontend } from './frontend.ts'
import { until } from '../process/testing.ts'

let M = identityEid('model', ['test'])

test('SQLite fork window reads limited bodies and projects position metadata', async () => {
  let h = await harness()
  try {
    await h.g.apply([
      { entity: { eid: 'p' }, session: {} },
      ...Array.from({ length: 100 }, (_, i) => ({
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
    assertEquals(page.entries[0].entity.eid, 'p68')
    assertEquals(page.total, 100)
    assertEquals(page.offset, 68)
    assert(
      queries.every((q) => q.includes('.fields=') || q.includes('.limit=32')),
    )
  } finally {
    h.close()
  }
})

test('mounted bounded transcript navigates beyond loaded edges and restores a detached session anchor', async () => {
  let store = await harness()
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
    start: () => Promise.resolve('s'),
    send: () => Promise.resolve('sent'),
    taskEntry: () => Promise.resolve({ task: 't', child: 'c' }),
    sessions: () =>
      Promise.resolve([{ entity: { eid: 's' }, session: { id: 'Session' } }, {
        entity: { eid: 'other' },
        session: { id: 'Other' },
      }]),
    usage: () => Promise.resolve([]),
    children: () => Promise.resolve([]),
    tasks: () => Promise.resolve([]),
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
    (ui.client.ent(derivedEid('viewport-s'))?.viewport as { selected?: string })
      ?.selected
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
      ...(ui.client.ent(derivedEid('viewport-s'))!.viewport as Record<
        string,
        unknown
      >),
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
      (ui.client.ent(derivedEid('viewport-s'))!.viewport as { follow: boolean })
        .follow,
      true,
    )
    assert(maximum <= 64)
  } finally {
    screen.free()
    ui.close()
    store.close()
  }
})

test('usage panel reads latest inherited ask metadata without transcript bodies', async () => {
  let store = await harness()
  try {
    await store.g.apply([
      { entity: { eid: 'p' }, session: {} },
      { entity: { eid: M }, model: { name: 'test' } },
      {
        entity: { eid: 'input' },
        entry: { session: 'p', seq: 1 },
        content: { body: 'old'.repeat(10000) },
      },
      {
        entity: { eid: 'ask' },
        entry: { session: 'p', seq: 2 },
        ask: { to: M, through: 'input' },
        usage: { input_tokens: 42 },
      },
      { entity: { eid: 'c' }, session: {}, fork: { from: 'ask' } },
      {
        entity: { eid: 'later' },
        entry: { session: 'p', seq: 3 },
        ask: { to: M, through: 'ask' },
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

// A window of eight out of a hundred: an unbounded read answers 400 KB of
// bodies where the window answers 32 KB.
test('a long transcript of large entries loads only a bounded body window', async () => {
  let store = await harness()
  try {
    const body = 'x'.repeat(4000)
    await store.g.apply([
      { entity: { eid: 's' }, session: {} },
      ...Array.from({ length: 100 }, (_, i) => ({
        entity: { eid: 'e' + i },
        entry: { session: 's', seq: i + 1 },
        content: { body },
      })),
    ])
    let page = await transcriptWindow(store.g, 's', { limit: 8 })
    assertEquals(page.entries.length, 8)
    assertEquals(page.entries[0].entity.eid, 'e92')
    assert(JSON.stringify(page).length < 42000)
  } finally {
    store.close()
  }
})

test('window counts exclude fork ancestor entries beyond its boundary', async () => {
  const h = await harness()
  try {
    await h.g.apply([
      { entity: { eid: 'parent' }, session: {} },
      ...Array.from({ length: 10 }, (_, i) => ({
        entity: { eid: 'p' + i },
        entry: { session: 'parent', seq: i + 1 },
        content: { body: 'parent' },
      })),
      { entity: { eid: 'child' }, session: {}, fork: { from: 'p4' } },
      {
        entity: { eid: 'c0' },
        entry: { session: 'child', seq: 6 },
        content: { body: 'child' },
      },
      {
        entity: { eid: 'c1' },
        entry: { session: 'child', seq: 7 },
        content: { body: 'child' },
      },
    ])
    const tail = await transcriptWindow(h.g, 'child', { limit: 3 })
    assertEquals(tail.entries.map((b) => b.entity.eid), ['p4', 'c0', 'c1'])
    assertEquals([tail.total, tail.offset], [7, 4])
    const head = await transcriptWindow(h.g, 'child', {
      limit: 3,
      edge: 'start',
    })
    assertEquals([head.total, head.offset], [7, 0])
  } finally {
    h.close()
  }
})
