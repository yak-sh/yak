// One renderer must keep its document structure across hosts. Mount it through
// the React Entity door, parse the text host's markdown, and compare the tags,
// words and link destinations a reader receives from those two paths.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { createElement as h } from 'react'
import { parseHTML } from 'linkedom'
import { marked } from 'marked'
import { entity } from '@yaks/react'
import { draw } from '@yaks/react/draw'
import { define } from '@yaks/render'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { render } from './mod.ts'

let vocab = loadVocab([{
  $defs: {
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' } },
    },
  },
}])
let bundle = { entity: { eid: 'page' }, doc: { title: 'yaks.app' } }
let registry = define([{
  view: 'Tile',
  match: parse('.doc'),
  render: (bundle, h) =>
    h(
      'article',
      null,
      h('h2', null, String((bundle.doc as { title: string }).title)),
      h(
        'p',
        null,
        'A ',
        h('strong', null, 'shared'),
        ' renderer with ',
        h('em', null, 'emphasis'),
        ', ',
        h('code', null, 'inline_code'),
        ', and ',
        h(
          'a',
          { href: 'https://example.test/page?from=render&mode=text' },
          'a link',
        ),
        '.',
      ),
      h(
        'ul',
        null,
        h('li', null, 'One choice'),
        h('li', null, 'Another choice'),
      ),
      h('ol', null, h('li', null, 'First step'), h('li', null, 'Second step')),
      h('pre', null, h('code', null, 'let ready = true')),
    ),
}])

// Block boundaries add whitespace when markdown is parsed; compare the reader's
// structure and words without depending on that serializer's indentation.
let signature = (root: Element) =>
  [...root.querySelectorAll('h2, p, strong, em, code, a, ul, ol, li, pre')]
    .map((element) => [
      element.localName,
      element.localName == 'ul' || element.localName == 'ol'
        ? element.children.length
        : element.textContent?.replace(/\s+/g, ' ').trim(),
      element.getAttribute('href'),
    ])

test('one renderer preserves its document through React and markdown', () => {
  let Entity = entity({ registry, vocab, store: () => bundle })
  let { document: browser } = parseHTML(
    '<html><body><main></main></body></html>',
  )
  let root = browser.querySelector('main')!
  let close = draw(h(Entity, { eid: 'page', view: 'Tile' }), root)
  try {
    let markdown = render(registry, bundle, 'Tile', vocab)
    let { document } = parseHTML(`<main>${marked.parse(markdown)}</main>`)
    assertEquals(root.querySelector('h2')?.textContent, 'yaks.app')
    assertEquals(root.querySelectorAll('li').length, 4)
    assertEquals(
      signature(document.querySelector('main')!),
      signature(root),
    )
  } finally {
    close()
  }
})
