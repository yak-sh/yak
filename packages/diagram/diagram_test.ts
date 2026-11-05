// A drawing places what a query selects, keeps each entity's place as the
// graph changes, and draws in only what is new.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { parseHTML } from 'linkedom'
import { ink, type Layout, layout, mount, progress, svg, tip } from './mod.ts'

let eid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let doc = (n: number, title = `doc ${n}`, more: object = {}): Bundle => ({
  entity: { eid: eid(n) },
  doc: { title },
  ...more,
})
let names = (b: Bundle[]) => layout(b).links.map((l) => l.name)
// Boxes are 72 by 25 each way, round shapes 46 by 44.
let overlap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < 2 * 72 && Math.abs(a.y - b.y) < 2 * 25

test('a property naming another selected entity is a line named comp.prop', () => {
  let a = doc(1), b = doc(2, 'b', { comment: { target: eid(1) } })
  assertEquals(names([a, b]), ['comment.target'])
  assertEquals(names([b]), [])
  assertEquals(
    names([doc(3, 'c', { tagged: { with: [eid(1), eid(2)] } }), a, doc(2)]),
    [
      'tagged.with',
      'tagged.with',
    ],
  )
  assertEquals(names([a, doc(2, 'b', { updated: { by: eid(1) } })]), [])
})

test('an edge entity is a line named by its other components, not a box', () => {
  let edge = {
    entity: { eid: eid(9) },
    edge: { from: eid(1), to: eid(2) },
    contains: {},
  }
  let drawn = layout([doc(1), doc(2), edge])
  assertEquals(drawn.nodes.map((n) => n.eid), [eid(1), eid(2)])
  assertEquals(drawn.links.map((l) => [l.name, l.eid]), [['contains', eid(9)]])
})

test('nodes carry a label, a title, their components, a shape, a state and an order', () => {
  let [n] = layout([
    doc(1, 'A title much longer than any box', {
      task: { status: 'open' },
      created: { at: 1 },
    }),
  ])
    .nodes
  assertEquals(n.label, '#0000000000')
  assertEquals(n.title, 'A title much longer than any box')
  assertEquals(n.comps, ['doc', 'task'])
  assertEquals([n.shape, n.state], ['box', 'open'])
  assertEquals([n.order, n.stage, n.fresh], [0, 0, true])
  let shapes = layout([
    doc(2, 'You', { person: {} }),
    doc(3, 'Agent', { persona: {} }),
    doc(4, 'Said', { comment: {} }),
  ]).nodes.map((n) => n.shape)
  assertEquals(shapes, ['round', 'hex', 'note'])
  assert(
    svg(layout([doc(1, 'A title much longer than any box')]))
      .includes('>A title much longe…<'),
  )
  assertEquals(layout([doc(1)], { label: () => 'D-1' }).nodes[0].label, 'D-1')
})

test('places stay put, newcomers take free spots beside what they name, and the sheet grows', () => {
  let first = layout([doc(1), doc(2)])
  let next = layout([
    doc(1),
    doc(2),
    doc(3, 'c', { comment: { target: eid(1) } }),
  ], { was: first })
  assertEquals(
    next.nodes.slice(0, 2),
    first.nodes.map((n) => ({ ...n, fresh: false })),
  )
  let c = next.nodes[2]
  assertEquals([c.order, c.fresh], [2, true])
  for (let n of next.nodes.slice(0, 2)) assert(!overlap(c, n))
  let many = layout(Array.from({ length: 40 }, (_, i) => doc(i)))
  assert(many.height > 480)
  for (let [i, a] of many.nodes.entries()) {
    for (let b of many.nodes.slice(i + 1)) {
      assert(!overlap(a, b), `${a.eid} overlaps ${b.eid}`)
    }
  }
  let gone = layout([doc(2), doc(4)], { was: first })
  assertEquals(gone.nodes.map((n) => [n.order, n.fresh]), [[1, false], [
    2,
    true,
  ]])
})

test('svg marks only what is new, in the order it is drawn, and escapes text', () => {
  let first = layout([doc(1, '<a & "b">')])
  let next = layout([
    doc(1, '<a & "b">'),
    doc(2, 'b', { comment: { target: eid(1) } }),
  ], {
    was: first,
  })
  let drawn = svg(next, { title: 'The graph' })
  assert(drawn.includes('&lt;a &amp; &quot;b&quot;&gt;'))
  assert(drawn.includes('<title>The graph</title>'))
  assertEquals(
    [...drawn.matchAll(/is-new" [^>]*?style="--i:(\d)"/g)].map((m) => m[1])
      .sort(),
    [
      '0',
      '1',
    ],
  )
  assertEquals(
    drawn.match(/class="Diagram_Node Diagram_Node-box"/g)?.length,
    1,
  )
})

test('a mount redraws after every commit, and takes a new query keeping places', async () => {
  let vocab = loadVocab({
    $defs: {
      doc: { component: true, properties: { title: { type: 'string' } } },
      note: {
        component: true,
        properties: { on: { type: 'string', format: 'uuid' } },
      },
    },
  })
  let g = graph({ vocab, storage: ram(vocab) })
  await g.apply([doc(1, 'Dune')])
  let sheet = { innerHTML: '' }
  let drawing = mount(sheet, { graph: g, query: '.doc' })
  let first = await drawing.redraw()
  assert(sheet.innerHTML.includes('Dune'))
  await g.apply([{ entity: { eid: eid(2) }, note: { on: eid(1) } }])
  await drawing.redraw()
  assertEquals(drawing.layout?.nodes.length, 1)
  let both = await drawing.query('.doc|.note')
  assertEquals(both.nodes[0].x, first.nodes[0].x)
  assertEquals(both.links.map((l) => l.name), ['note.on'])
  await g.apply([doc(3, 'Emma')])
  await drawing.redraw()
  assert(sheet.innerHTML.includes('Emma'))
  drawing.stop()
})

test('what a mount drew comes back from another query with its stage, place and order', async () => {
  let vocab = loadVocab({
    $defs: {
      doc: { component: true, properties: { title: { type: 'string' } } },
      note: { component: true, properties: { text: { type: 'string' } } },
    },
  })
  let g = graph({ vocab, storage: ram(vocab) })
  await g.apply([doc(1, 'Dune'), {
    entity: { eid: eid(2) },
    note: { text: 'a' },
  }])
  let drawing = mount({ innerHTML: '' }, {
    graph: g,
    query: '.doc',
    stage: () => 1,
  })
  let first = await drawing.redraw()
  await drawing.query('.note', 7)
  let back = await drawing.query('.doc', 9)
  let shown = (
    { stage, x, y, order }: Layout['nodes'][0],
  ) => [stage, x, y, order]
  assertEquals(back.nodes.map(shown), first.nodes.map(shown))
  drawing.stop()
})

test('a pinned entity sits where it is pinned, and the rest spread from the middle', () => {
  let pins: Record<string, [number, number]> = { 'D-1': [.2, .1] }
  let drawn = layout([doc(1), doc(2)], {
    width: 600,
    height: 500,
    label: (b) => `D-${Number(b.entity.eid.slice(-1))}`,
    at: ({ label }) => pins[label],
  })
  assertEquals([drawn.nodes[0].x, drawn.nodes[0].y], [120, 50])
  let [, b] = drawn.nodes
  assert(Math.abs(b.x - 300) < 80 && Math.abs(b.y - 250) < 80, `${b.x},${b.y}`)
})

let story = () => {
  let one = layout([doc(1)], { stage: 1 })
  return layout([doc(1), doc(2, 'b', { comment: { target: eid(1) } })], {
    was: one,
    stage: 2,
  })
}

test('a pen draws each stage in as it is reached, a shape before the line to it', () => {
  let drawn = story()
  assertEquals(drawn.nodes.map((n) => n.stage), [1, 2])
  assertEquals(drawn.links.map((l) => l.stage), [2])
  let at = (p1: number, p2: number) =>
    [...progress(drawn, (s) => s == 1 ? p1 : p2).values()].map((t) =>
      +t.toFixed(2)
    )
  assertEquals(at(0, 0), [0, 0, 0])
  assertEquals(at(1, 0), [1, 0, 0])
  assertEquals(at(1, .3), [1, .69, 0])
  assertEquals(at(1, 1), [1, 1, 1])
  assertEquals(tip(drawn, progress(drawn, () => 1)), undefined)
  let pen = tip(drawn, progress(drawn, (s) => s == 1 ? 1 : .3))
  assertEquals([pen?.key, pen?.stage], [eid(2), 2])
})

test('ink draws a drawing in a page as far as each item has come, and puts the pen there', () => {
  let drawn = story()
  let { document } = parseHTML(`<div>${svg(drawn)}</div>`)
  let sheet = document.querySelector('svg')!
  let state = (key: string) =>
    ['is-gone', 'is-drawing', 'is-drawn'].filter((c) =>
      sheet.querySelector(`[data-key="${key}"]`)!.classList.contains(c)
    )
  let pen = ink(sheet as never, drawn, progress(drawn, (s) => s == 1 ? 1 : .3))
  assertEquals(pen?.key, eid(2))
  assertEquals([state(eid(1)), state(eid(2))], [['is-drawn'], ['is-drawing']])
  assertEquals(state(drawn.links[0].key), ['is-gone'])
  assertEquals(
    sheet.querySelector('.Diagram_Pen')!.getAttribute('opacity'),
    '1',
  )
  ink(sheet as never, drawn, progress(drawn, () => 1))
  assertEquals(
    sheet.querySelector('.Diagram_Pen')!.getAttribute('opacity'),
    '0',
  )
})
