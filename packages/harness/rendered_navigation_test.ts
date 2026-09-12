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

Deno.test('rendered Markdown tables, quotes, code and boxes keep layout while selecting', async () => {
  const { TElement, install } = await import('../tui/dom.ts')
  const { render } = await import('preact')
  const { lay } = await import('../tui/paint.ts')
  const { theme } = await import('../tui/theme.ts')
  const { copyRendered } = await import('../tui/RenderedCursor.ts')
  const dom = install()
  const root = new TElement('div')
  try {
    render(
      h(
        'div',
        { border: 'Composer_Border', wrap: '1' },
        h(Markdown, {
          source:
            '> **quote**\n\n```\ncode\n\nline\n```\n\n| A | B |\n|---|---|\n| one | two |',
        }),
      ),
      root as unknown as Element,
    )
    const rows = lay(root, {}, 40, null, { sheet: theme, metrics: {} })
    const text = copyRendered(
      {
        id: 'a',
        row: rows.length - 1,
        col: 39,
        anchor: { id: 'a', row: 0, col: 0 },
      },
      ['a'],
      () => rows,
    )
    assert(text.includes('quote'))
    assert(text.includes('code'))
    assert(text.includes('one'))
    assert(!/[╭╮╰╯│─┼┬┴]/.test(text), text)
    assert(!text.includes('**'))
  } finally {
    render(null, root as unknown as Element)
    dom.free()
  }
})

Deno.test('rendered cursor requests bounded neighboring windows and selects across overlap', async () => {
  const f = frontend(), copies: string[] = [], requested: string[] = []
  const entries: Bundle[] = Array.from(
    { length: 140 },
    (_, i) => ({
      entity: { eid: 'e' + i },
      entry: { session: 's', seq: i + 1 },
      content: { body: 'row' + i },
    }),
  )
  const a: UIAgent = {
    sessions: () =>
      Promise.resolve([{
        entity: { eid: 's' },
        session: { id: 's', status: 'settled' },
      }]),
    tasks: () => Promise.resolve([]),
    children: () => Promise.resolve([]),
    transcript: () => Promise.reject(new Error('full transcript forbidden')),
    transcriptWindow: (_s, request = {}) => {
      requested.push(request.anchor ?? request.edge ?? 'tail')
      const at = request.anchor
        ? entries.findIndex((e) => e.entity.eid == request.anchor)
        : request.edge == 'start'
        ? 0
        : 139
      const start = Math.max(0, Math.min(76, at - 24)),
        end = Math.min(140, start + 64)
      return Promise.resolve({
        entries: entries.slice(start, end),
        before: start > 0,
        after: end < 140,
      })
    },
    start: () => Promise.resolve('s'),
    send: () => Promise.resolve('x'),
    taskEntry: () => Promise.resolve({ task: 't', child: 'c' }),
    line: () => '',
    entry: (b) => h('div', null, String((b.content as Comp).body)),
  }
  f.patch({ selected: 's' })
  f.keys({ mode: 'NORMAL', focus: 'transcript' })
  f.client.mutate([{
    entity: { eid: 'viewport-s' },
    viewport: {
      selected: 'e0',
      item: 'e0',
      offset: 0,
      follow: false,
      windowEdge: 'start',
    },
  }])
  const ui = await mount(
    () => h(App, { agent: a, frontend: f, subscribe: () => () => {} }),
    100,
    25,
  )
  setClipboard((t) => copies.push(t))
  try {
    await settle()
    await ui.send('')
    for (let i = 0; i < 60; i++) {
      await ui.send('j')
      await settle()
    }
    await ui.send('v')
    for (let i = 0; i < 12; i++) {
      await ui.send('j')
      await settle()
    }
    await ui.send('y')
    assert(copies[0]?.includes('row60'), String(copies))
    assert(copies[0]?.includes('row71'), String(copies))
    assert(requested.length < 20, JSON.stringify(requested))
    assertEquals((f.client.ent('viewport-s')!.viewport as Comp).selected, 'e72')
  } finally {
    setClipboard()
    ui.free()
    await f.close()
  }
})
