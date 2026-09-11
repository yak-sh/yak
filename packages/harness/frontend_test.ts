import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import { frontend } from './frontend.ts'
import { App } from './app.ts'
import type { UIAgent } from './panels.ts'
import { mount } from '../tui/harness.ts'

Deno.test('frontend graph is private, transient and query granular', async () => {
  let a = frontend(), b = frontend()
  let viewChanges = 0, draftChanges = 0
  a.view.subscribe(() => viewChanges++)
  a.draft.subscribe(() => draftChanges++)
  try {
    a.edit({ text: 'private draft', at: 7 })
    assertEquals(draftChanges, 1)
    assertEquals(viewChanges, 0)
    assertEquals(b.draft.value[0].draft, { text: '', at: 0 })
    assertEquals(a.client.wire, undefined)
    a.patch({ selected: 'session', mode: 'task', showSettled: true })
    assertEquals(viewChanges, 1)
    assertEquals(draftChanges, 2) // changing sessions selects a separate draft
    a.patch({ mode: 'message', error: 'visible' })
    assertEquals(viewChanges, 1) // composer/feedback are independently subscribed
    let viewport = a.viewport('reading')
    viewport.set({ follow: false, anchor: { id: 'entry', offset: 3 } })
    assertEquals(viewport.watch.value[0].viewport, {
      item: 'entry',
      offset: 3,
      follow: false,
    })
    viewport.watch.close()
  } finally {
    await a.close()
    b.close()
  }
})

Deno.test('typing in frontend does not reread domain or render history (10,000 entries)', async () => {
  let reads = 0, renders = 0
  let entries = Array.from({ length: 10_000 }, (_, i) => ({
    entity: { eid: 'e' + i },
    entry: { seq: i, session: 's' },
    content: { body: 'line ' + i },
  }))
  let agent: UIAgent = {
    start: () => Promise.resolve('s'),
    send: () => Promise.resolve('sent'),
    taskEntry: () => Promise.resolve({ task: 't', child: 'c' }),
    sessions: () => {
      reads++
      return Promise.resolve([{
        entity: { eid: 's' },
        session: { status: 'settled' },
      }])
    },
    tasks: () => Promise.resolve([]),
    children: () => Promise.resolve([]),
    transcript: () => {
      reads++
      return Promise.resolve(entries)
    },
    line: () => '',
    entry: (b) => {
      renders++
      return h('div', null, b.entity.eid)
    },
  }
  let ui = await mount(
    () => h(App, { agent, panels: [], subscribe: () => () => {} }),
    80,
    20,
  )
  try {
    await ui.send('\x0e')
    for (let i = 0; i < 100; i++) await Promise.resolve()
    await ui.send('')
    let beforeReads = reads, beforeRenders = renders
    assert(renders > 0 && renders < 100, String(renders))
    await ui.send('typing some words')
    assertEquals(reads, beforeReads)
    assertEquals(renders, beforeRenders)
    await ui.send('\x1bvlll')
    await ui.send('y')
    assertEquals(reads, beforeReads)
    assertEquals(renders, beforeRenders)
  } finally {
    ui.free()
  }
})

Deno.test('external frontend writes drive controlled input and selection', async () => {
  let state = frontend()
  let selected: string[] = [], sent: string[] = []
  let agent: UIAgent = {
    start: () => Promise.resolve('s'),
    send: (session, text) => {
      sent.push(session + ':' + text)
      return Promise.resolve('sent')
    },
    taskEntry: () => Promise.resolve({ task: 't', child: 'c' }),
    sessions: () => Promise.resolve([]),
    tasks: () => Promise.resolve([]),
    children: () => Promise.resolve([]),
    transcript: (id) => {
      selected.push(id)
      return Promise.resolve([])
    },
    entry: () => null,
    line: () => '',
  }
  let ui = await mount(
    () =>
      h(App, { frontend: state, agent, panels: [], subscribe: () => () => {} }),
    80,
    15,
  )
  try {
    state.patch({ selected: 'chosen' })
    state.edit({ text: 'draft', at: 2 })
    for (let i = 0; i < 8; i++) await Promise.resolve()
    await ui.send('X\r')
    assertEquals(sent, ['chosen:drXaft'])
    assertEquals(state.draft.value[0].draft, { text: '', at: 0 })
    assert(selected.includes('chosen'))
  } finally {
    ui.free()
    state.close()
  }
})

Deno.test('VISUAL state and local yank belong only to their frontend graph', async () => {
  let a = frontend(), b = frontend()
  try {
    a.select({ surface: 'input', text: 'draft', anchor: 0, at: 2, yank: 'dra' })
    assertEquals(
      (a.visual.value[0].visual as Record<string, unknown>).yank,
      'dra',
    )
    assertEquals(
      (b.visual.value[0].visual as Record<string, unknown>).surface,
      '',
    )
    assertEquals((b.visual.value[0].visual as Record<string, unknown>).yank, '')
  } finally {
    await a.close()
    b.close()
  }
})
