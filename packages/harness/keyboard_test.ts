import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import {
  Textarea,
  useVisualController,
  VirtualList,
  type VisualState,
} from '@yaks/tui'
import type { Comp } from '@yaks/graph'
import { mount } from '../tui/harness.ts'
import { frontend } from './frontend.ts'
import { Keyboard } from './keyboard.ts'

Deno.test('controlled NORMAL routing preserves draft, selects sources, and hides help in INSERT', async () => {
  let f = frontend(), sent: string[] = [], actions: string[] = []
  let items = Array.from(
    { length: 1000 },
    (_, i) => ({ id: String(i), text: 'row ' + i }),
  )
  let measured = 0
  let App = () => {
    useVisualController(
      () => f.client.ent('visual')!.visual as VisualState,
      f.select,
    )
    let draft = f.draft.value[0].draft as Comp
    return h(
      'div',
      { col: '1' },
      h(VirtualList<{ id: string; text: string }>, {
        id: 'transcript-new',
        grow: '1',
        items,
        textOf: (v: { text: string }) => v.text,
        renderItem: (v: { text: string }) => {
          measured++
          return h('div', null, v.text)
        },
      }),
      h(Keyboard, {
        ui: f,
        action: (key) => {
          actions.push(key.text ?? key.name)
          return true
        },
      }),
      h(Textarea, {
        value: { text: String(draft.text), at: Number(draft.at) },
        onEdit: f.edit,
        onSubmit: (s: string) => sent.push(s),
      }),
    )
  }
  let ui = await mount(App, 80, 15)
  let keys = () => f.client.ent('keyboard')!.keyboard as Comp
  let text = () => (f.client.ent('draft')!.draft as Comp).text
  try {
    await ui.send('draft?')
    assertEquals(text(), 'draft?')
    await ui.send('\x1b')
    assertEquals(keys().mode, 'NORMAL')
    await ui.send('jkhlnp')
    assertEquals(text(), 'draft?')
    assertEquals(actions, ['n', 'p'])
    await ui.send('?')
    assertEquals(keys().help, true)
    assert(ui.text().includes('next / previous root'))
    await ui.send('\x1b')
    assertEquals(keys().help, false)
    assertEquals(keys().mode, 'NORMAL')
    await ui.send('g')
    await ui.send('g')
    assert(ui.text().includes('row 0'))
    await ui.send('G')
    assert(ui.text().includes('row 999'))
    await ui.send('v')
    assertEquals(keys().mode, 'VISUAL')
    await ui.send('ly')
    assertEquals(keys().mode, 'NORMAL')
    assertEquals((f.client.ent('visual')!.visual as Comp).yank, 'ro')
    await ui.send('v\x1b')
    assertEquals(keys().mode, 'NORMAL')
    await ui.send('\tjl')
    assertEquals(keys().focus, 'sidebar')
    assertEquals(actions.slice(-2), ['j', 'l'])
    await ui.send('ixy')
    assertEquals(keys().mode, 'INSERT')
    assertEquals(text(), 'draft?xy')
    let before = measured
    await ui.send('z')
    assertEquals(measured, before)
    assertEquals(sent, [])
  } finally {
    ui.free()
    f.close()
  }
})

Deno.test('NORMAL sidebar commands use the same session actions and INSERT remains literal', async () => {
  const { App } = await import('./app.ts')
  let f = frontend(), sent: string[] = []
  let sessions = [
    { entity: { eid: 'root' }, session: { id: 'Root', status: 'pending' } },
    {
      entity: { eid: 'child' },
      session: { id: 'Child', status: 'pending' },
      spawned: { parent: 'root' },
    },
    { entity: { eid: 'other' }, session: { id: 'Other', status: 'pending' } },
  ]
  let a: import('./panels.ts').UIAgent = {
    sessions: () => Promise.resolve(sessions),
    tasks: () => Promise.resolve([]),
    children: () => Promise.resolve([]),
    transcript: (id) =>
      Promise.resolve([{
        entity: { eid: id + '-entry' },
        entry: { session: id, seq: 1 },
        content: { body: 'history ' + id },
      }]),
    line: () => '',
    entry: () => h('div', null, 'history'),
    send: (_id, text) => {
      sent.push(text)
      return Promise.resolve('input')
    },
    start: () => Promise.resolve('root'),
    taskEntry: () => Promise.resolve({ task: 'task', child: 'child' }),
  }
  let ui = await mount(
    () => h(App, { frontend: f, agent: a, subscribe: () => () => {} }),
    100,
    30,
  )
  let selected = () => (f.client.ent('view')!.frontend as Comp).selected
  try {
    await ui.send('draft')
    await ui.send('\x1b')
    await ui.send('n')
    assertEquals(selected(), 'root')
    await ui.send('\tl')
    assertEquals(selected(), 'child')
    await ui.send('h')
    assertEquals(selected(), 'root')
    await ui.send('j')
    assertEquals(selected(), 'other')
    await ui.send('?')
    assert(ui.text().includes('next / previous root'))
    await ui.send('\x1b')
    await ui.send('i?hjkl')
    assertEquals((f.client.ent('draft')!.draft as Comp).text, 'draft?hjkl')
    assertEquals(sent, [])
  } finally {
    ui.free()
    f.close()
  }
})
