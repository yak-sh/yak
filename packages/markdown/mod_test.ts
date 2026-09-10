import { h } from 'preact'
import { mount } from '../preact/harness.ts'
import { assert, assertEquals } from '@std/assert'
import { Markdown, parse, render, safeHref } from './mod.ts'
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
