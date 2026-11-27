import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { createElement as h, type ReactElement } from 'react'
import { renderToString } from 'preact-render-to-string'
import { block, el } from './el.ts'
import { Field } from './Field.ts'
import { Site } from '@yaks/markdown/site'
import { parseHTML } from 'linkedom'

let html = renderToString
let Dot = el('span', 'Dot')
let Card = block('div', 'Card', { Head: 'header' })

test('a part wears its block, its variants and extra classes', () => {
  let cases: [ReactElement, string][] = [
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
  let cases: [ReactElement, string][] = [
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

test('a part linking off the page site opens it in a new tab', () => {
  let Id = el('span', 'Id')
  let on = (node: ReactElement) =>
    html(h(Site.Provider, { value: ['yaks.app'] }, node))
  assertEquals(
    on(h(Id, { href: 'https://discord.com/x' }, 'x')),
    '<a href="https://discord.com/x" target="_blank" rel="noopener" class="Id">x</a>',
  )
  assertEquals(
    on(h(Id, { href: 'https://ada.yaks.app/' }, 'x')),
    '<a href="https://ada.yaks.app/" target="_blank" rel="noopener" class="Id">x</a>',
  )
  assertEquals(
    on(h(Id, { href: 'https://yaks.app/pricing' }, 'x')),
    '<a href="https://yaks.app/pricing" class="Id">x</a>',
  )
  assertEquals(
    on(h(Id, { href: 'https://discord.com/x', target: '_self' }, 'x')),
    '<a target="_self" href="https://discord.com/x" class="Id">x</a>',
  )
  // Drawn with no site given and no location to read, every address leaves.
  assertEquals(
    html(h(Id, { href: 'https://yaks.app/' }, 'x')),
    '<a href="https://yaks.app/" target="_blank" rel="noopener" class="Id">x</a>',
  )
})

let Wrapped = el(Field, 'Wrapped')
test('a composed field keeps its input kind and an explicit element', () => {
  for (let Part of [Field, Wrapped]) {
    for (
      let [props, tag] of [
        [{ placeholder: 'Write a note…' }, 'INPUT'],
        [{ lines: true, placeholder: 'Write a note…' }, 'TEXTAREA'],
        [{ choose: true }, 'SELECT'],
        [{ lines: true, as: 'input', placeholder: 'Write a note…' }, 'INPUT'],
      ] as const
    ) {
      let { document } = parseHTML(html(h(Part, props)))
      assertEquals(document.querySelector('.Field')?.tagName, tag)
    }
  }
})
