// The HTML host keeps registry behavior and the browser's document structure,
// including literal content that would become markup without serialization.

import { assertEquals } from '@std/assert'
import { h } from 'preact'
import { parseHTML } from 'linkedom'
import { entity } from '@yaks/preact'
import { define } from '@yaks/render'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { mount } from '../preact/harness.ts'
import { render } from './mod.ts'

let vocab = loadVocab([{
  $defs: {
    doc: { type: 'object', properties: { title: { type: 'string' } } },
  },
}])
let bundle = { entity: { eid: 'page' }, doc: { title: '<b>"A&B"</b>' } }
let registry = define([{
  view: 'Tile',
  match: parse('.doc'),
  render: (b, h, ctx) =>
    h(
      'a',
      { class: 'Card', href: ctx.href, title: bundle.doc.title },
      h('img', { src: '/icon.png', width: 44, alt: '' }),
      h('strong', null, (b.doc as typeof bundle.doc).title),
      [0, [false, null, undefined, true, ' tail']],
      h('button', { disabled: true, onClick: () => {} }, 'Open'),
      h('span', { hidden: false, 'aria-hidden': false }, 'Visible'),
    ),
}])
let ctx = { href: '/?q="<&' }

let signature = (root: Element): unknown => [
  root.localName,
  Object.fromEntries([...root.attributes].map((a) => [a.name, a.value])),
  [...root.childNodes].map((n) =>
    n.nodeType == 1 ? signature(n as Element) : n.textContent
  ),
]

Deno.test('HTML escapes content and agrees with the mounted Preact view', () => {
  let html = render(registry, bundle, 'Library.Tile', vocab, ctx)
  let { document } = parseHTML(`<main>${html}</main>`)
  let root = document.querySelector('main')!
  root.normalize()
  let card = root.querySelector('a')!
  assertEquals(card.getAttribute('title'), bundle.doc.title)
  assertEquals(card.getAttribute('href'), ctx.href)
  assertEquals(card.querySelector('strong')?.textContent, bundle.doc.title)
  assertEquals(card.querySelector('b'), null)
  assertEquals(card.querySelector('button')?.getAttribute('onClick'), null)
  assertEquals(card.querySelector('span')?.hasAttribute('hidden'), false)
  let Entity = entity({ registry, vocab, store: () => bundle })
  let mounted = mount(h(Entity, { eid: 'page', view: 'Library.Tile', ...ctx }))
  try {
    mounted.root.normalize()
    assertEquals(signature(card), signature(mounted.root.firstElementChild!))
  } finally {
    mounted.free()
  }
})

Deno.test('HTML retains missing, unnamed and JSON fallback view behavior', () => {
  assertEquals(render(registry, bundle, 'Missing', vocab), '')
  assertEquals(
    render(registry, { entity: { eid: 'empty' } }, 'Tile', vocab),
    '',
  )
  assertEquals(
    render(registry, bundle, undefined, vocab, ctx),
    render(registry, bundle, 'Tile', vocab, ctx),
  )
  let fallback = define([{
    view: 'JSON',
    match: true,
    render: (b, h) => h('pre', null, b.entity.eid),
  }])
  assertEquals(render(fallback, bundle, 'Missing', vocab), '<pre>page</pre>')
})

Deno.test('HTML forwards column selection and renderer context', () => {
  let editors = define([{
    view: 'Edit',
    match: parse('.column.type=string'),
    render: (b, h, ctx) => {
      assertEquals(b, bundle)
      assertEquals(
        [ctx.comp, ctx.col, ctx.label],
        ['doc', 'title', 'Title'],
      )
      return h('label', null, String(ctx.label))
    },
  }])
  assertEquals(
    render(editors, bundle, 'Edit', vocab, {
      comp: 'doc',
      col: 'title',
      label: 'Title',
    }),
    '<label>Title</label>',
  )
})

Deno.test('HTML omits portable action data without running it', () => {
  let called = false
  let registry = define([{
    view: 'Edit',
    match: true,
    render: (_b, h) =>
      h('input', {
        value: 'Before',
        onChange: {
          name: 'Change title',
          run: () => {
            called = true
            return { doc: { title: 'After' } }
          },
        },
      }),
  }])
  assertEquals(
    render(registry, bundle, 'Edit', vocab),
    '<input value="Before"/>',
  )
  assertEquals(called, false)
})

Deno.test('an empty child list does not replace a textarea value during serialization', () => {
  let registry = define([{
    view: 'Edit',
    match: true,
    render: (_b, h) => h('textarea', { value: '<b>before</b>' }),
  }])
  assertEquals(
    render(registry, bundle, 'Edit', vocab),
    '<textarea>&lt;b>before&lt;/b></textarea>',
  )
})
