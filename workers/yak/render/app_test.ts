// The library's row is a row of the kit's Rows, drawn by the registry's view.
// Exercise both the served page and a mounted Preact host with the same data.

import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { type ComponentChildren, h } from 'preact'
import { parseHTML } from 'linkedom'
import { entity } from '@yaks/preact'
import { resolve } from '@yaks/render'
import { mount } from '../../../packages/preact/testing.ts'
import { markup } from '../html.ts'
import { desk } from '../desk-pages.ts'
import { app } from '@yaks/platform/app-tile'
import { registry, tile, vocab } from './mod.ts'

type Listed = Parameters<typeof tile>[0]
let row = (node: ComponentChildren) => {
  let { document } = parseHTML(typeof node == 'string' ? node : markup(node))
  return document.querySelector('#apps > .Rows_Item') ??
    document.querySelector('.Rows_Item')!
}
let one = (a: Partial<Listed> = {}, around: Parameters<typeof tile>[1] = {}) =>
  row(tile({ eid: 'app-1', slug: 'recipes', title: 'Recipes', ...a }, around))
let signature = (root: Element): unknown => [
  root.localName,
  Object.fromEntries([...root.attributes].map((a) => [a.name, a.value])),
  root.textContent,
  [...root.children].map(signature),
]
let links = (root: Element) =>
  [...root.querySelectorAll('a')].map((a) => [
    a.textContent,
    a.getAttribute('href'),
  ])
let said = (root: Element) =>
  [...root.querySelectorAll('[role=img]')].map((m) =>
    m.getAttribute('data-tip')
  )
let bundle = {
  entity: { eid: 'app-1' },
  app: { slug: 'recipes', access: 'private' },
  doc: { title: 'Recipes' },
  home: {},
}

test('app Tile resolves by component and draws the same row served and mounted', async () => {
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
      gallery: 'waiting for the gallery',
    }],
    view: 'apps',
  }).text()
  let served = row(html)
  assertEquals(served.querySelector('.Rows_Open')?.textContent, 'Recipes')
  assertEquals(links(served), [
    ['Recipes', 'https://ada.yaks.app/recipes/'],
    ['Edit data', 'https://ada.yaks.app/recipes/_web/data'],
    ['Visits', '/manage/ada/visits#visits-recipes'],
  ])
  assertEquals(
    served.querySelector('.Rows_Mark img')?.getAttribute('src'),
    'https://ada.yaks.app/recipes/icon.png?display',
  )
  assertEquals(
    served.querySelector('.Rows_Main .Rows_Meta')?.textContent,
    '/recipes · waiting for the gallery',
  )

  let Entity = entity({ registry, vocab: vocab(), store: () => bundle })
  let mounted = mount(h(Entity, {
    eid: 'app-1',
    view: 'List.Tile',
    gallery: 'waiting for the gallery',
    at: 'https://ada.yaks.app',
    editor: true,
    visits: '/manage/ada/visits#visits-recipes',
  }))
  try {
    assertEquals(signature(mounted.root.firstElementChild!), signature(served))
  } finally {
    mounted.free()
  }
})

test('app Tile says who may use it and whether it is the homepage, as glyphs with words', () => {
  let words = {
    public: 'Public: anyone can open it, and its members change its data',
    open: 'Open: anyone with the link can open it and change its data',
    private: 'Private: only people let in can open it',
  }
  for (let home of [false, true]) {
    for (let access of [null, 'public', 'open', 'private'] as const) {
      let root = one({ title: '', home, access }, {
        at: 'https://ada.yaks.app',
      })
      assertEquals(root.querySelector('.Rows_Open')?.textContent, 'recipes')
      assertEquals(
        said(root),
        [
          home ? 'The homepage: it opens at ada.yaks.app' : null,
          access ? words[access] : null,
        ].filter(Boolean),
      )
      for (let m of root.querySelectorAll('[role=img]')) {
        assertEquals(m.getAttribute('aria-label'), m.getAttribute('data-tip'))
      }
    }
  }
})

test('app Tile says when it last changed, by whom where that was not the viewer, and its menu only to whoever may edit', () => {
  let writers = new Map([['ada', 'Ada'], ['probe', 'probe for Ada']])
  let made = { at: '2026-01-01T00:00:00Z', by: 'probe' }
  let deployed = { at: '2026-02-01T00:00:00Z', by: 'ada' }
  let line = (stamps: object, me = 'ada') => {
    let root = one({}, { ...stamps, writers, me })
    let time = root.querySelector('.Rows_Main .Rows_Meta time')
    let text = root.querySelector('.Rows_Main .Rows_Meta')!.textContent!
    return [
      root.getAttribute('data-changed'),
      time?.getAttribute('datetime') ?? null,
      time ? text.replace(time.textContent!, 'WHEN') : text,
    ]
  }
  // Never deployed: when it was made, by the agent that made it.
  assertEquals(line({ made }), [
    made.at,
    made.at,
    '/recipes · changed WHEN by probe for Ada',
  ])
  // Last deployed by the viewer: theirs goes unsaid; to anyone else, named.
  assertEquals(line({ made, deployed }), [
    deployed.at,
    deployed.at,
    '/recipes · changed WHEN',
  ])
  assertEquals(
    line({ made, deployed }, 'bo')[2],
    '/recipes · changed WHEN by Ada',
  )
  assertEquals(line({}), ['', null, '/recipes'])
  assertEquals(one().querySelector('details'), null)
  assert(one({}, { editor: true }).querySelector('details[data-menu]'))
})

test('app Tile opens its errors from a badge and from its menu', () => {
  assertEquals(one({}, { editor: true }).querySelector('[popovertarget]'), null)
  for (let [n, words] of [[1, '1 error'], [3, '3 errors']] as const) {
    let root = one({}, { errors: n, editor: true })
    let opens = [
      ...root.querySelectorAll('button[popovertarget="fix-recipes"]'),
    ]
    assertEquals(opens.map((b) => b.textContent), [words, `See ${words}`])
    assertEquals(opens[0].className, 'Badge')
  }
})

test('app Tile escapes every label and attribute once', () => {
  let text = '<script>"A&B\'s"</script>'
  let root = one(
    { slug: text, title: text, access: text, gallery: text },
    { errors: 2, editor: true },
  )
  assertEquals(
    root.querySelector('.Rows_Open')?.getAttribute('href'),
    `/${text}/`,
  )
  assertEquals(
    root.querySelector('[popovertarget]')?.getAttribute('popovertarget'),
    `fix-${text}`,
  )
  assertEquals(
    root.querySelector('img')?.getAttribute('src'),
    `/${text}/icon.png?display`,
  )
  assertEquals(root.querySelector('.Rows_Open')?.textContent, text)
  assertEquals(
    root.querySelector('.Rows_Main .Rows_Meta')?.textContent,
    `/${text} · ${text}`,
  )
  assertEquals(root.querySelector('script'), null)
})
