import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { h, type VNode } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { block, el } from './el.ts'
import { Field } from './Field.ts'
import { parseHTML } from 'linkedom'

let html = (node: VNode) => renderToString(node)
let Dot = el('span', 'Dot')
let Card = block('div', 'Card', { Head: 'header' })

test('a part wears its block, its variants and extra classes', () => {
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
    [h(Card.Head, { as: 'div' }, 'x'), '<div class="Card_Head">x</div>'],
    [h(Card, { as: 'li', href: '/a' }), '<a href="/a" class="Card"></a>'],
    [
      h(el('textarea', 'Field'), { value: 'a<b' }),
      '<textarea class="Field">a&lt;b</textarea>',
    ],
  ]
  for (let [node, want] of cases) assertEquals(html(node), want)
})

test('a part drawn as another wears both, in its own element', () => {
  let Button = el('button', 'Button')
  let Panel = el('section', 'Tabs_Panel')
  let Copy = block('span', 'Copy', { Go: Button })
  let Report = block(Card, 'Report', { Total: 'p' })
  let cases: [VNode, string][] = [
    [
      h(Panel, { as: Card, mod: 'claude' }, 'x'),
      '<section class="Card Tabs_Panel Tabs_Panel-claude">x</section>',
    ],
    [
      h(Copy.Go, { type: 'button' }),
      '<button type="button" class="Button Copy_Go"></button>',
    ],
    [h(Report, { id: 'r' }), '<div id="r" class="Card Report"></div>'],
    [h(Report, { as: 'article' }), '<article class="Card Report"></article>'],
    [h(Report, { href: '/a' }), '<a href="/a" class="Card Report"></a>'],
  ]
  for (let [node, want] of cases) assertEquals(html(node), want)
})

test('links nest the way HTML allows', () => {
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

let Wrapped = el(Field, 'Wrapped')
test('a composed field keeps its input kind and an explicit element', () => {
  for (let Part of [Field, Wrapped]) {
    for (
      let [props, tag] of [
        [{}, 'INPUT'],
        [{ lines: true }, 'TEXTAREA'],
        [{ choose: true }, 'SELECT'],
        [{ lines: true, as: 'input' }, 'INPUT'],
      ] as const
    ) {
      let { document } = parseHTML(html(h(Part, props)))
      assertEquals(document.querySelector('.Field')?.tagName, tag)
    }
  }
})
