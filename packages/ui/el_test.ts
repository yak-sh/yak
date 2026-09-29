import { assertEquals } from '@std/assert'
import { h, type VNode } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { block, el } from './el.ts'

let html = (node: VNode) => renderToString(node)
let Dot = el('span', 'Dot')
let Card = block('div', 'Card', { Head: 'header' })

Deno.test('a part wears its block, its variants and extra classes', () => {
  let cases: [VNode, string][] = [
    [h(Dot, {}), '<span class="Dot"></span>'],
    [h(Dot, { mod: 'ring' }), '<span class="Dot Dot-ring"></span>'],
    [
      h(Dot, { mod: ['half', false, null, 'active'], class: 'Tile_Dot' }),
      '<span class="Dot Dot-half Dot-active Tile_Dot"></span>',
    ],
    [
      h(Card.Head, { mod: 'on' }, 'x'),
      '<header class="Card_Head Card_Head-on">x</header>',
    ],
    [h(Dot, { title: 'wip' }), '<span title="wip" class="Dot"></span>'],
  ]
  for (let [node, want] of cases) assertEquals(html(node), want)
})

Deno.test('links nest the way HTML allows', () => {
  let Id = el('span', 'Id')
  // An href makes the part the link.
  assertEquals(
    html(h(Id, { href: '/T-1' }, 'T-1')),
    '<a href="/T-1" class="Id">T-1</a>',
  )
  // Inside it, the same href is no second link, and another keeps its tag
  // and says where it goes.
  assertEquals(
    html(h(Card, { href: '/T-1' }, h(Id, { href: '/T-1' }, 'T-1'))),
    '<a href="/T-1" class="Card"><span class="Id">T-1</span></a>',
  )
  assertEquals(
    html(h(Card, { href: '/T-1' }, h(Id, { href: '/T-2' }, 'T-2'))),
    '<a href="/T-1" class="Card"><span role="link" tabindex="0" ' +
      'data-href="/T-2" class="Id">T-2</span></a>',
  )
})
