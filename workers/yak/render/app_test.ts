// The library's card is the kit's Card, drawn by the registry's view.
// Exercise both the served page and a mounted Preact host with the same data.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type ComponentChildren, h } from 'preact'
import { parseHTML } from 'linkedom'
import { entity } from '@yaks/preact'
import { resolve } from '@yaks/render'
import { mount } from '../../../packages/preact/testing.ts'
import { markup } from '../html.ts'
import { desk } from '../desk-pages.ts'
import { app } from './app.ts'
import { registry, tile, vocab } from './mod.ts'

let card = (node: ComponentChildren) => {
  let { document } = parseHTML(typeof node == 'string' ? node : markup(node))
  return (document.querySelector('.Cards > .Card') ??
    document.querySelector('.Card'))!
}
let signature = (root: Element): unknown => [
  root.localName,
  Object.fromEntries([...root.attributes].map((a) => [a.name, a.value])),
  root.textContent,
  [...root.children].map(signature),
]
let bundle = {
  entity: { eid: 'app-1' },
  app: { slug: 'recipes', access: 'private' },
  doc: { title: 'Recipes' },
  home: {},
}

test('app Tile resolves by component and keeps its links in served and mounted pages', async () => {
  assertEquals(resolve(registry, bundle, 'List.Tile', vocab()), app)
  assertEquals(
    resolve(
      registry,
      { entity: bundle.entity, doc: bundle.doc },
      'Tile',
      vocab(),
    ),
    undefined,
  )
  let html = await desk({
    space: 'ada',
    apps: [{
      eid: 'app-1',
      slug: 'recipes',
      title: 'Recipes',
      home: true,
      access: 'private',
      gallery: 'gallery: waiting',
    }],
    view: 'apps',
  }).text()
  let expected = card(html)
  assertEquals(expected.querySelector('h2')?.textContent, 'Recipes')
  assertEquals(
    [...expected.querySelectorAll('a')].map((
      a,
    ) => [a.textContent, a.getAttribute('href')]),
    [
      ['Recipes', 'https://ada.yaks.app/recipes/'],
      ['Edit data', 'https://ada.yaks.app/recipes/_web/data'],
    ],
  )
  assertEquals(expected.querySelector('a a'), null)

  let Entity = entity({ registry, vocab: vocab(), store: () => bundle })
  let mounted = mount(h(Entity, {
    eid: 'app-1',
    view: 'List.Tile',
    gallery: 'gallery: waiting',
    at: 'https://ada.yaks.app',
    editor: true,
  }))
  try {
    assertEquals(
      signature(mounted.root.firstElementChild!),
      signature(expected),
    )
  } finally {
    mounted.free()
  }
})

test('app Tile preserves title fallback and badge order', () => {
  for (let home of [false, true]) {
    for (let access of [null, 'public', 'open', 'private']) {
      for (let gallery of [undefined, 'in the gallery', 'gallery: waiting']) {
        let root = card(tile({
          eid: 'app-1',
          slug: 'recipes',
          title: '',
          home,
          access,
          gallery,
        }))
        assertEquals(root.querySelector('h2')?.textContent, 'recipes')
        assertEquals(
          root.querySelectorAll('.Chips').length,
          Number(home || !!access || !!gallery),
        )
        assertEquals(
          [...root.querySelectorAll('.Chip')].map((t) => t.textContent),
          [home ? 'Homepage' : null, access, gallery].filter(Boolean),
        )
      }
    }
  }
})

test('app Tile escapes every label and attribute once', () => {
  let text = '<script>"A&B\'s"</script>'
  let root = card(tile(
    {
      eid: 'app-1',
      slug: text,
      title: text,
      access: text,
      gallery: text,
    },
    { errors: 2 },
  ))
  assertEquals(
    root.querySelector('h2 a')?.getAttribute('href'),
    `/${text}/`,
  )
  assertEquals(
    root.querySelector('[href^="#fix-"]')?.getAttribute('href'),
    `#fix-${text}`,
  )
  assertEquals(
    root.querySelector('img')?.getAttribute('src'),
    `/${text}/icon.png?display`,
  )
  assertEquals(root.querySelector('h2')?.textContent, text)
  assertEquals(root.querySelector('.Card_Sub')?.textContent, `/${text}`)
  assertEquals(
    [...root.querySelectorAll('.Chip')].map((t) => t.textContent),
    [text, text],
  )
  assertEquals(root.querySelector('script'), null)
})
