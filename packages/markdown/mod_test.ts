import { h } from 'preact'
import { mount } from '../preact/testing.ts'
import { assert, assertEquals } from '@std/assert'
import { headings, Markdown, parse, render, safeHref } from './mod.ts'
import type { H } from '@yaks/render'

type Tree = {
  tag: string
  props: Record<string, unknown> | null
  children: unknown[]
}
let tree: H<Tree> = (tag, props, ...children) => ({ tag, props, children })

Deno.test('GFM becomes portable semantic elements, not HTML strings', () => {
  let doc = render(
    parse(
      '# Title\n\n**bold** *italic* ~~gone~~ `code`\n\n> quote\n\n- [x] done\n\n```ts\nlet x = 1\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |',
    ),
    tree,
  )
  let json = JSON.stringify(doc)
  for (
    let tag of [
      'h1',
      'strong',
      'em',
      'del',
      'code',
      'blockquote',
      'ul',
      'li',
      'pre',
      'table',
      'th',
      'td',
    ]
  ) {
    assert(json.includes('"tag":"' + tag + '"'), tag)
  }
  assert(json.includes('[x] '))
})

Deno.test('untrusted markup and URLs never become executable nodes', () => {
  let doc = render(
    parse(
      '<script>alert(1)</script>\n\n[x](javascript:alert) ![alt](https://example.com/a.png)',
    ),
    tree,
  )
  let json = JSON.stringify(doc)
  assert(!json.includes('"tag":"script"'))
  assert(!json.includes('"tag":"img"'))
  assert(!json.includes('"href":"javascript:'))
  assert(json.includes('<script>'))
  for (
    let url of [
      'javascript:foo',
      'data:text/html,x',
      'java\nscript:foo',
      '\x1b]8;;bad',
    ]
  ) assertEquals(safeHref(url), undefined)
  assertEquals(safeHref('https://example.com'), 'https://example.com')
})

Deno.test('Preact component produces ordinary web-compatible elements', () => {
  let doc = Markdown({ source: '**hello**' })
  assertEquals(doc.type, 'div')
  assertEquals(
    (doc.props as unknown as Record<string, unknown>).class,
    'Markdown',
  )
})

Deno.test('Markdown mounts as safe semantic browser DOM', () => {
  let ui = mount(
    h(Markdown, {
      source:
        '# Title\n\n**bold** *italic* [safe](https://example.com)\n\n<script>bad</script>',
    }),
  )
  try {
    assertEquals(ui.root.querySelector('h1')?.textContent, 'Title')
    assertEquals(ui.root.querySelector('strong')?.textContent, 'bold')
    assertEquals(ui.root.querySelector('em')?.textContent, 'italic')
    assertEquals(
      ui.root.querySelector('a')?.getAttribute('href'),
      'https://example.com',
    )
    assertEquals(ui.root.querySelector('script'), null)
    assert(ui.root.textContent?.includes('<script>bad</script>'))
  } finally {
    ui.free()
  }
})

// A heading is a place in a document, so it carries the name that place is
// linked by. `headings` reads the same names out without drawing anything,
// which is what a contents list is built from.
Deno.test('headings carry anchor ids a contents list can link', () => {
  let source = '# The `store`\n\n## Saving "a" <thing>\n\n## Queries\n' +
    '\n### Queries\n\n## Queries\n\n## !!!\n'
  let tokens = parse(source, { breaks: false })
  assertEquals(headings(tokens), [
    { depth: 1, text: 'The store', id: 'the-store' },
    { depth: 2, text: 'Saving "a" <thing>', id: 'saving-a-thing' },
    { depth: 2, text: 'Queries', id: 'queries' },
    { depth: 3, text: 'Queries', id: 'queries-2' },
    { depth: 2, text: 'Queries', id: 'queries-3' },
    { depth: 2, text: '!!!', id: 'section' },
  ])
  // The renderer gives the headings those very ids, in that order.
  let json = JSON.stringify(render(tokens, tree))
  for (let h of headings(tokens)) {
    assert(json.includes(`"id":"${h.id}"`), h.id)
  }
  // Nothing an attribute could be broken open with survives the name.
  assert(!/"id":"[^"]*[<>&'`]/.test(json), json)
})

// A comment is a note to whoever opens the file — the pointer beside a number
// on a documentation page, say — and it belongs nowhere on the page.
Deno.test('a comment is not painted, and markup still is, as text', () => {
  let json = JSON.stringify(
    render(parse('<!-- a note -->\n\nwords <b>bold</b>\n'), tree),
  )
  assert(!json.includes('a note'), json)
  assert(json.includes('<b>'), json)
})

Deno.test('explicit source newlines become structural breaks before terminal rendering', () => {
  let tokens = parse('first\n**second**\n\nthird')
  assertEquals(tokens.map((t) => t.type), ['paragraph', 'space', 'paragraph'])
  let first = render([tokens[0]], tree)
  let json = JSON.stringify(first)
  assert(json.includes('"tag":"br"'), json)
  assert(json.includes('"tag":"strong"'), json)
})
