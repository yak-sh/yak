import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import type { Bundle, Comp } from '@yaks/graph'
import { setClipboard } from '../tui/visual.ts'
import { Markdown } from '@yaks/markdown'
import { mount } from '../tui/harness.ts'
import { frontend } from './frontend.ts'
import { App } from './app.ts'
import type { UIAgent } from './panels.ts'
const settle = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve()
}
Deno.test('NORMAL and VISUAL operate on rendered Markdown without replacing it; detail is explicit', async () => {
  const f = frontend(), copies: string[] = []
  const entries: Bundle[] = [{
    entity: { eid: 'e1' },
    entry: { session: 's', seq: 1 },
    content: { body: '**bold** and _soft_\nnext' },
  }, {
    entity: { eid: 'e2' },
    entry: { session: 's', seq: 2 },
    content: { body: 'other' },
  }]
  let reads = 0, inspections = 0
  const a: UIAgent = {
    sessions: () =>
      Promise.resolve([{
        entity: { eid: 's' },
        session: { id: 's', status: 'settled' },
      }]),
    tasks: () => Promise.resolve([]),
    children: () => Promise.resolve([]),
    transcript: () => {
      reads++
      return Promise.resolve(entries)
    },
    start: () => Promise.resolve('s'),
    send: () => Promise.resolve('x'),
    taskEntry: () => Promise.resolve({ task: 't', child: 'c' }),
    line: () => '',
    entry: (b) =>
      h('div', null, h(Markdown, { source: String((b.content as Comp).body) })),
    entrySource: (_s, eid) => {
      inspections++
      return Promise.resolve({
        eid,
        component: 'content',
        property: 'body',
        text: '**bold** and _soft_\nnext',
        revision: 'r',
        start: 0,
        end: 24,
        total: 24,
        next: null,
      })
    },
  }
  f.patch({ selected: 's' })
  f.keys({ mode: 'NORMAL', focus: 'transcript' })
  f.client.mutate([{
    entity: { eid: 'viewport-s' },
    viewport: { selected: 'e1', item: 'e1', offset: 0, follow: false },
  }])
  const ui = await mount(
    () => h(App, { agent: a, frontend: f, subscribe: () => () => {} }),
    100,
    28,
  )
  setClipboard((text) => copies.push(text))
  try {
    await settle()
    await ui.send('')
    assert(ui.text().includes('bold and soft'), ui.text())
    assert(!ui.text().includes('**bold**'))
    await ui.send('vll')
    assertEquals((f.client.ent('keyboard')!.keyboard as Comp).mode, 'VISUAL')
    assert(ui.text().includes('bold and soft'))
    assert(!ui.text().includes('**bold**'))
    await ui.send('y')
    assertEquals(copies, ['bol'])
    assertEquals((f.client.ent('keyboard')!.keyboard as Comp).mode, 'NORMAL')
    await ui.send('\r')
    await settle()
    await ui.send('')
    assert(ui.text().includes('**bold**'), ui.text())
    assertEquals(inspections, 1)
    await ui.send('\x1b')
    assert(!ui.text().includes('**bold**'))
    await ui.send('\x17l')
    assertEquals((f.client.ent('keyboard')!.keyboard as Comp).focus, 'sidebar')
    await ui.send('\x17h')
    assertEquals(
      (f.client.ent('keyboard')!.keyboard as Comp).focus,
      'transcript',
    )
    await ui.send('i')
    const before = reads
    await ui.send('draft')
    assertEquals((f.client.ent('draft')!.draft as Comp).text, 'draft')
    assertEquals(reads, before)
  } finally {
    setClipboard()
    ui.free()
    await f.close()
  }
})
