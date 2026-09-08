// The library keeps its existing card DOM while the registry supplies the view.
// Exercise both the served page and a mounted Preact host with the same data.

import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { parseHTML } from 'linkedom'
import { entity } from '@yaks/preact'
import { resolve } from '@yaks/render'
import { mount } from '../../../packages/preact/harness.ts'
import { spaceIndex } from '../pages.ts'
import { app } from './app.ts'
import { registry, tile, vocab } from './mod.ts'

let card = (html: string) => {
  let { document } = parseHTML(html)
  return document.querySelector('.Apps_Item')!
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

Deno.test('app Tile resolves by component and keeps the library card DOM', async () => {
  assertEquals(resolve(registry, bundle, 'List.Tile', vocab), app)
  assertEquals(
    resolve(
      registry,
      { entity: bundle.entity, doc: bundle.doc },
      'Tile',
      vocab,
    ),
    undefined,
  )
  let html = await spaceIndex({
    space: 'ada',
    title: 'Ada',
    apps: [{
      eid: 'app-1',
      slug: 'recipes',
      title: 'Recipes',
      home: true,
      access: 'private',
      gallery: 'gallery: waiting',
    }],
    hidden: 0,
    role: 'owner',
    person: true,
    signIn: '/login',
    view: 'apps',
  }).text()
  let expected = card(
    `<a class="Apps_Item" href="/recipes/" target="_blank" rel="noopener">
<img src="/recipes/icon.png" width="44" height="44" alt="">
<strong>Recipes</strong><span class="Apps_Path">/recipes</span>
<span class="Apps_Tags"><span class="Apps_Tag">Homepage</span><span class="Apps_Tag">private</span><span class="Apps_Tag">gallery: waiting</span></span></a>`,
  )
  assertEquals(signature(card(html)), signature(expected))

  let Entity = entity({ registry, vocab, store: () => bundle })
  let mounted = mount(h(Entity, {
    eid: 'app-1',
    view: 'List.Tile',
    gallery: 'gallery: waiting',
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

Deno.test('app Tile preserves title fallback, empty tags and badge order', () => {
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
        assertEquals(root.querySelector('strong')?.textContent, 'recipes')
        assertEquals(root.querySelectorAll('.Apps_Tags').length, 1)
        assertEquals(
          [...root.querySelectorAll('.Apps_Tag')].map((t) => t.textContent),
          [home ? 'Homepage' : null, access, gallery].filter(Boolean),
        )
      }
    }
  }
})

Deno.test('app Tile escapes every label and attribute once', () => {
  let text = '<script>"A&B\'s"</script>'
  let root = card(tile({
    eid: 'app-1',
    slug: text,
    title: text,
    access: text,
    gallery: text,
  }))
  assertEquals(root.getAttribute('href'), `/${text}/`)
  assertEquals(
    root.querySelector('img')?.getAttribute('src'),
    `/${text}/icon.png`,
  )
  assertEquals(root.querySelector('strong')?.textContent, text)
  assertEquals(root.querySelector('.Apps_Path')?.textContent, `/${text}`)
  assertEquals(
    [...root.querySelectorAll('.Apps_Tag')].map((t) => t.textContent),
    [text, text],
  )
  assertEquals(root.querySelector('script'), null)
})
