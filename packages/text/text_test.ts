// The text boundary is tested at every path that can print content, while
// formatting tests read Markdown back as HTML so punctuation and nesting are
// checked for their meaning as well as their source.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { marked } from 'marked'
import { define } from '@yaks/render'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { h, markdown, plain, render, safe, safeHref } from './mod.ts'

let { document } = parseHTML('<main></main>')
let html = (text: string) => {
  let main = document.createElement('main')
  main.innerHTML = String(marked.parse(text))
  return main
}
let controls = Array.from({ length: 160 }, (_, n) => n)
  .filter((n) => n < 32 || n >= 127)
  .map((n) => String.fromCharCode(n)).join('')

let dirty = `one${controls}two`
let controlled = ['span', 'custom', 'h1', 'p', 'code', 'pre', 'strong', 'em']
  .map((tag) => {
    let node = h(tag, null, dirty)
    return { node, parsed: html(markdown(node)) }
  })
let controlledLink = h('a', { href: `https://yaks.app/${controls}page` }, dirty)
test('every C0/DEL/C1 byte is stripped from text and hrefs in both modes', () => {
  assertEquals(safe(dirty), 'onetwo')
  assertEquals(safeHref(dirty), 'onetwo')
  for (let { node, parsed } of controlled) {
    assertEquals(plain(node), 'onetwo')
    assertEquals(parsed.textContent?.trim(), 'onetwo')
  }
  assertEquals(markdown(controlledLink), '[onetwo](https://yaks.app/page)')
  assertEquals(plain(controlledLink), 'onetwo (https://yaks.app/page)')
})

test('all controls are removed even when leaves and hrefs change after h', () => {
  let props = { href: 'before' }
  let node = h('a', props, 'before')
  props.href = `a${controls}b`
  node.children = [h('span', null, `a${controls}b`)]
  assertEquals(markdown(node), '[ab](ab)')
  assertEquals(plain(node), 'ab')
})

test('content controls cannot become terminal commands on code or link paths', () => {
  let attack = '\x1b]52;c;payload\x07\x9b31mRED\x1b[0m'
  let clean = ']52;c;payload31mRED[0m'
  for (let tag of ['span', 'pre', 'code', 'custom']) {
    assertEquals(plain(h(tag, null, attack)), clean)
    assertEquals(
      html(markdown(h(tag, null, attack))).textContent?.trim(),
      clean,
    )
  }
  assertEquals(
    decodeURIComponent(
      html(markdown(h('a', { href: `https://yaks.app/${attack}` }, 'link')))
        .querySelector('a')!.getAttribute('href')!,
    ),
    `https://yaks.app/${clean}`,
  )
})

test('literal line controls disappear while structural breaks survive', () => {
  let node = h(
    'div',
    null,
    h('p', null, 'one\n\rtwo\tthree'),
    h('p', null, 'four', h('br', null), 'five'),
  )
  assertEquals(markdown(node), 'onetwothree\n\nfour  \nfive')
  assertEquals(plain(node), 'onetwothree\n\nfour\nfive')
})

test('text punctuation and entity spellings remain literal Markdown content', () => {
  let texts = [
    '*_[x](y)!',
    '<b>&amp;',
    '# title',
    '1. row',
    '- row',
    'a\\b',
    'yaks.app',
  ]
  let nodes = texts.map((text) => h('p', null, text))
  let paragraphs = html(nodes.map(markdown).join('\n\n')).querySelectorAll('p')
  assertEquals(paragraphs.length, texts.length)
  for (let [i, text] of texts.entries()) {
    assertEquals(paragraphs[i].textContent, text)
    assertEquals(paragraphs[i].children.length, 0)
    assertEquals(plain(nodes[i]), text)
  }
  let node = h('p', null, '!', h('a', { href: '/page' }, 'page'))
  let parsed = html(markdown(node))
  assertEquals(parsed.querySelectorAll('img').length, 0)
  assertEquals(parsed.querySelectorAll('a').length, 1)
})

test('nested arrays and inline children preserve exact spaces and zero', () => {
  let node = h(
    'span',
    null,
    ['a', [0, false, null, undefined, true]],
    ' ',
    h('custom', null, 'b'),
  )
  assertEquals(markdown(node), 'a0 b')
  assertEquals(plain(node), 'a0 b')
  assertEquals(markdown([h('p', null, 'a'), [h('p', null, 'b')]]), 'a\n\nb')
  for (let value of [false, true, null, undefined, []]) {
    assertEquals(markdown(value), '')
    assertEquals(plain(value), '')
  }
})

test('headings and emphasis keep their structure and whitespace', () => {
  let node = h(
    'section',
    null,
    h('h3', null, 'Heading'),
    h('p', null, 'a', h('strong', null, ' bold '), h('em', null, 'word')),
  )
  assertEquals(markdown(node), '### Heading\n\na **bold** *word*')
  assertEquals(plain(node), 'Heading\n\na bold word')
  let parsed = html(markdown(node))
  assertEquals(parsed.querySelector('strong')?.textContent, 'bold')
  assertEquals(parsed.querySelector('em')?.textContent, 'word')
  assertEquals(markdown(h('strong', null, '  ')), '  ')
})

let nestedList = h(
  'ul',
  null,
  h('li', null, 'One', h('ul', null, h('li', null, 'Nested'))),
  h('li', null, 'Two'),
)
let orderedList = h(
  'ol',
  { start: 9 },
  h('li', null, 'One', h('br', null), 'continued'),
  h('li', null, 'Two', h('ul', null, h('li', null, 'Nested'))),
)
let nestedHTML = html(markdown(nestedList))
let orderedHTML = html(markdown(orderedList))
test('nested and ordered lists keep indentation and start numbering', () => {
  assertEquals(markdown(nestedList), '- One\n  - Nested\n- Two')
  assertEquals(plain(nestedList), '- One\n  - Nested\n- Two')
  assertEquals(nestedHTML.querySelectorAll('ul ul li').length, 1)
  assertEquals(
    plain(orderedList),
    '9. One\n   continued\n10. Two\n    - Nested',
  )
  assertEquals(orderedHTML.querySelector('ol')?.getAttribute('start'), '9')
  assertEquals(orderedHTML.querySelectorAll('ol > li').length, 2)
  assertEquals(
    markdown(h('ol', { start: 'bad' }, h('li', null, 'One'))),
    '1. One',
  )
})

test('link destinations cannot close Markdown syntax and plain mode keeps destinations', () => {
  let href = 'https://yaks.app/a(b) <c>\\d'
  let node = h('a', { href }, 'label [x]')
  let parsed = html(markdown(node)).querySelector('a')!
  assertEquals(parsed.textContent, 'label [x]')
  assertEquals(
    parsed.getAttribute('href'),
    'https://yaks.app/a%28b%29%20%3Cc%3E%5Cd',
  )
  assertEquals(plain(node), `label [x] (${href})`)
  assertEquals(markdown(h('a', null, 'label')), 'label')
  assertEquals(plain(h('a', { href: '/page' }, '/page')), '/page')
  assertEquals(plain(h('a', { href: '/page' })), '/page')
  assertEquals(markdown(h('a', { href: '\n\t' }, 'label')), 'label')
})

test('inline code and fences outgrow embedded backtick runs', () => {
  let texts = ['a`b', '`edge`', ' a ', ' ', '**literal**']
  let codes = texts.map((text) => h('code', null, text))
  let node = h('pre', null, h('code', null, '```', h('br', null), '<b>*x*'))
  let adjacent = h('p', null, h('code', null, 'one'), h('code', null, 'two'))
  let parsed = html([...codes, node, adjacent].map(markdown).join('\n\n'))
  let inline = [...parsed.querySelectorAll('p > code')].map((el) =>
    el.textContent
  )
  assertEquals(inline, [...texts, 'one', 'two'])
  for (let [i, code] of codes.entries()) assertEquals(plain(code), texts[i])
  assertEquals(markdown(node), '````\n```\n<b>*x*\n````')
  assertEquals(plain(node), '```\n<b>*x*')
  assertEquals(parsed.querySelector('pre code')?.textContent, '```\n<b>*x*\n')
  assertEquals(markdown(h('pre', null, 'one', h('br', null))), '```\none\n```')
  assertEquals(plain(adjacent), 'onetwo')
})

test('href entity spellings remain literal, including encoded control references', () => {
  let hrefs = ['&copy;', '&#x1b;', '&#27;', '&#x9b;', '&amp;#x1b;']
    .map((suffix) => `https://yaks.app/?a=${suffix}&b=two`)
  let links = hrefs.map((href) => h('a', { href }, 'link'))
  let parsed = html(links.map(markdown).join('\n\n'))
  assertEquals(
    [...parsed.querySelectorAll('a')].map((link) => link.getAttribute('href')),
    hrefs,
  )
  for (let [i, link] of links.entries()) {
    assertEquals(plain(link), `link (${hrefs[i]})`)
  }
})

test('transparent wrappers retain block boundaries, including at the root', () => {
  let node = h(
    'custom',
    null,
    h('span', null, h('p', null, 'one')),
    h('custom', null, h('p', null, 'two')),
    'three',
  )
  assertEquals(markdown(node), 'one\n\ntwo\n\nthree')
  assertEquals(plain(node), 'one\n\ntwo\n\nthree')
  assertEquals(html(markdown(node)).querySelectorAll('p').length, 3)
})

let emphasis = ['strong', 'em'].map((tag) => {
  let adjacent = h(
    'span',
    null,
    h(tag, null, 'one'),
    h('span', null, h(tag, null, 'two')),
  )
  let nested = h(tag, null, 'a', h(tag, null, 'b'), 'c')
  return {
    tag,
    adjacent,
    adjacentHTML: html(markdown(adjacent)),
    nestedHTML: html(markdown(nested)),
  }
})
test('adjacent and nested emphasis preserve elements rather than delimiter text', () => {
  for (let { tag, adjacent, adjacentHTML, nestedHTML } of emphasis) {
    assertEquals(
      [...adjacentHTML.querySelectorAll(tag)].map((el) => el.textContent),
      ['one', 'two'],
    )
    assertEquals(plain(adjacent), 'onetwo')
    assertEquals(nestedHTML.querySelector(`${tag} > ${tag}`)?.textContent, 'b')
    assertEquals(nestedHTML.querySelector('p')?.textContent, 'abc')
  }
})

let lists = ['ul', 'ol'].map((tag) => ({
  tag,
  parsed: html(markdown(h(
    'div',
    null,
    h(tag, null, h('li', null, 'one')),
    h('custom', null, h(tag, null, h('li', null, 'two'))),
  ))),
}))
let paragraphed = h(
  'ul',
  null,
  h('li', null, h('p', null, 'one'), h('p', null, 'two')),
)
let paragraphedHTML = html(markdown(paragraphed))
test('independent lists keep their boundaries and restart numbering', () => {
  for (let { tag, parsed } of lists) {
    let found = parsed.querySelectorAll(tag)
    assertEquals(found.length, 2)
    assertEquals([...found].map((list) => list.children.length), [1, 1])
  }
  assertEquals(
    [...paragraphedHTML.querySelectorAll('li > p')].map((el) => el.textContent),
    ['one', 'two'],
  )
  assertEquals(plain(paragraphed), '- one\n  \n  two')
})

test('render resolves views and property context, and missing views are empty', () => {
  let vocab = loadVocab([{
    $defs: {
      doc: {
        component: true,
        type: 'object',
        properties: { title: { type: 'string' } },
      },
    },
  }])
  let registry = define([{
    view: 'Edit',
    match: parse('.prop.type=string'),
    render: (b, h, ctx) =>
      h(
        'code',
        null,
        String((b[ctx.comp!] as Record<string, unknown>)[ctx.prop!]),
      ),
  }])
  let bundle = { entity: { eid: 'a' }, doc: { title: 'A page' } }
  let ctx = { comp: 'doc', prop: 'title' }
  assertEquals(render(registry, bundle, 'Form.Edit', vocab, ctx), '`A page`')
  assertEquals(render(registry, bundle, 'Edit', vocab, ctx, 'plain'), 'A page')
  assertEquals(render(registry, bundle, 'Missing', vocab), '')
})

test('definition lists pair terms and values across grouped and direct rows', () => {
  let node = h(
    'dl',
    null,
    h('div', null, h('dt', null, 'Title'), h('dd', null, 'A *page*')),
    h('dt', null, 'Count'),
    h('dd', null, 2),
    h('dd', null, 'More'),
  )
  assertEquals(markdown(node), 'Title: A \\*page\\*  \nCount: 2  \nMore')
  assertEquals(html(markdown(node)).querySelectorAll('br').length, 2)
  assertEquals(plain(node), 'Title: A *page*\nCount: 2\nMore')
})

test('nested text views retain registry context and always render read-only', () => {
  let registry = define([
    {
      view: 'Props',
      match: true,
      render: (_b, h, ctx) => {
        assertEquals(ctx.readOnly, true)
        return h(
          'dl',
          null,
          h('dt', null, 'Title'),
          h(
            'dd',
            null,
            ctx.render?.('Nested.Edit', { prop: 'title', readOnly: false }),
          ),
        )
      },
    },
    {
      view: 'Edit',
      match: parse('.prop.type=string'),
      render: (b, h, ctx) => {
        assertEquals(ctx.readOnly, true)
        assertEquals(ctx.extra, 'kept')
        return h('span', null, String((b.doc as { title: string }).title))
      },
    },
  ])
  let vocab = loadVocab([{
    $defs: {
      doc: {
        component: true,
        type: 'object',
        properties: { title: { type: 'string' } },
      },
    },
  }])
  assertEquals(
    render(
      registry,
      { entity: { eid: 'a' }, doc: { title: 'A page' } },
      'Props',
      vocab,
      { comp: 'doc', extra: 'kept', readOnly: false },
      'plain',
    ),
    'Title: A page',
  )
})
