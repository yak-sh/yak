import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import type { Comp } from '@yaks/graph'
import { frontend } from './frontend.ts'
import { InspectionPanel, inspector } from './inspect_ui.ts'
import { Keyboard } from './keyboard.ts'
import type { UIAgent } from './panels.ts'
import { mount } from '../tui/harness.ts'
import { open } from './store.ts'
import { inspection } from './inspection.ts'

Deno.test('NORMAL search reveals matches, bounds detail, and preserves draft and viewport on close', async () => {
  const f = frontend(), db = open(':memory:')
  await db.g.apply([
    { entity: { eid: 's' }, session: { id: 's' } },
    {
      entity: { eid: 'a' },
      entry: { session: 's' },
      content: { body: 'needle A\n' + 'line\n'.repeat(1000) },
      prompt: { scope: 'shared' },
    },
    {
      entity: { eid: 'b' },
      entry: { session: 's' },
      content: { body: 'needle B' },
    },
  ])
  f.patch({ selected: 's' })
  f.keys({ mode: 'NORMAL' })
  f.edit({ text: 'my draft', at: 3 })
  const handle = inspector(f, inspection(db.g) as UIAgent)
  const view = await mount(
    () =>
      h(
        'div',
        { col: '1' },
        h(InspectionPanel, { ui: f }),
        h(Keyboard, { ui: f, action: () => true, inspectKey: handle }),
      ),
    90,
    24,
  )
  const settle = async (predicate: () => boolean) => {
    for (let i = 0; i < 100 && !predicate(); i++) {
      await new Promise((r) => setTimeout(r, 1))
      await view.send('')
    }
    assert(predicate(), JSON.stringify(f.client.ent('inspection')))
  }
  const s = () => f.client.ent('inspection')!.inspection as Comp
  try {
    await view.send('/needle\r')
    await settle(() => Number(s().index) == 0)
    assertEquals((f.client.ent('viewport-s')!.viewport as Comp).item, 'a')
    await view.send('n')
    assertEquals((f.client.ent('viewport-s')!.viewport as Comp).item, 'b')
    await view.send('N')
    assertEquals((f.client.ent('viewport-s')!.viewport as Comp).item, 'a')
    await view.send('\r')
    await settle(() => s().mode == 'detail' && !!s().text)
    assert(view.text().includes('Instructions · literal source'), view.text())
    assert(String(s().text).length <= 4096)
    await view.send(']')
    await settle(() => Number(s().start) == 4096)
    await view.send('\x1b')
    assertEquals(s().mode, '')
    assertEquals(f.client.ent('draft')!.draft, { text: 'my draft', at: 3 })
    assertEquals((f.client.ent('viewport-s')!.viewport as Comp).item, 'a')
    await view.send('/missing\r')
    await settle(() => s().message == 'No matches')
    await view.send('/unfinished\x1b')
    assertEquals(s().mode, '')
  } finally {
    view.free()
    f.close()
    db.close()
  }
})
