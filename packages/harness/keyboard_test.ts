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
