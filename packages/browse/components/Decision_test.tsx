/** @jsxImportSource preact */
// A decision's choices draw what they show, each by what it is: one tree,
// read as the browser's elements and as the terminal paints it.
import '../tui/doc.ts'
import { test, until } from '../testing.ts'
import { assertEquals } from '@std/assert'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { TElement } from '@yaks/tui'
import { cache, ent } from '../live.ts'
import { host, reader } from '../host_testing.ts'
import { pageEid } from '@yaks/page'
import { Decision } from './Decision.tsx'
import { pane } from '../tui/testing.ts'
import '../domain-host.tsx'

let draft = pageEid('https://draft.example/')
let row = (eid: string, comps: Record<string, object>) => ({
  entity: { eid },
  ...Object.fromEntries(
    Object.entries(comps).map(([name, comp]) => [name, { eid, ...comp }]),
  ),
})
let edge = (to: string, choice: string, ord: number) =>
  row(`shows-${to}`, {
    edge: { from: 'ask', to, ord },
    shows: { choice },
  })
let rows = [
  row('ask', {
    task: {},
    doc: { title: 'Which look?' },
    decision: {
      question: 'Which look?',
      choices: [
        { label: 'Warm', description: 'Ochre and cream' },
        { label: 'Plain', description: 'The words alone' },
        { label: 'Live', description: 'The draft itself' },
      ],
      recommended: 'Warm',
    },
  }),
  row('mock', { artifact: { address: 'abc123', media_type: 'image/png' } }),
  row('words', { doc: { title: 'The pitch', body: 'Build *apps*.' } }),
  row(draft, { web: { url: 'https://draft.example/' } }),
  edge('mock', 'Warm', 0),
  edge('words', 'Plain', 1),
  edge(draft, 'Live', 2),
]

test('each choice draws what it shows over its button: an image, prose, a page at two widths', async () => {
  let read = reader(rows)
  let wire = host(({ subscribe }) => ({ bundles: read(subscribe) }))
  cache.value = Object.fromEntries(rows.map((b) => [b.entity.eid, b]))
  let root = new TElement('root')
  let target = root as unknown as Parameters<typeof render>[1]
  try {
    await act(() => render(h(Decision, { e: ent('ask') }), target))
    await until(() => root.querySelectorAll('.Gallery_Figure').length == 3, {
      label: 'three figures',
    })
    await until(() => !!root.querySelector('iframe'), { label: 'a page' })
    let figures = [...root.querySelectorAll('.Gallery_Figure')]
    assertEquals(
      figures[0].querySelector('img')?.getAttribute('src'),
      '/blob/abc123',
    )
    assertEquals(figures[1].querySelector('em')?.textContent, 'apps')
    assertEquals(
      [...figures[2].querySelectorAll('iframe')].map((f) => [
        f.getAttribute('src'),
        f.getAttribute('class'),
      ]),
      [
        ['https://draft.example/', 'Preview_Frame Preview_Frame-desktop'],
        ['https://draft.example/', 'Preview_Frame Preview_Frame-phone'],
      ],
    )
    let text = pane(root).lines.map((line) =>
      line.map((span) => span.text).join('')
    ).join('\n')
    for (
      let said of [
        '/blob/abc123',
        'The pitch',
        'Build apps',
        'https://draft.example/',
        '1. Warm',
        '3. Live',
      ]
    ) assertEquals(text.includes(said), true, said)
  } finally {
    render(null, target)
    wire.free()
  }
})
