// A drawing places what a query selects, keeps each entity's place as the
// graph changes, and draws in only what is new.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { BOX, layout, mount, svg } from './mod.ts'

let eid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let doc = (n: number, title = `doc ${n}`, more: object = {}): Bundle => ({
  entity: { eid: eid(n) },
  doc: { title },
  ...more,
})
let names = (b: Bundle[]) => layout(b).links.map((l) => l.name)
let overlap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < 2 * BOX.w && Math.abs(a.y - b.y) < 2 * BOX.h

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

test('nodes carry a label, a title cut to fit, their components and an order', () => {
  let [n] = layout([
    doc(1, 'A title much longer than any box', {
      task: {},
      created: { at: 1 },
    }),
  ])
    .nodes
  assertEquals(n.label, '#0000000000')
  assertEquals(n.title, 'A title much longer t…')
  assertEquals(n.comps, ['doc', 'task'])
  assertEquals([n.order, n.fresh], [0, true])
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
  assertEquals(drawn.match(/class="Diagram_Node"/g)?.length, 1)
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
