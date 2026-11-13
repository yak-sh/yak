import { test } from '@yaks/testing'
import { h } from 'preact'
import { mount } from '../preact/testing.ts'
import { assert, assertEquals } from '@std/assert'
import {
  blocks,
  drawn,
  headings,
  Host,
  Markdown,
  MarkdownInline,
  mentions,
  type Options,
  parse,
  render,
  safeHref,
  stored,
  typed,
} from './mod.ts'
import type { H } from '@yaks/render'

type Tree = {
  tag: string
  props: Record<string, unknown> | null
  children: unknown[]
}
let tree: H<Tree> = (tag, props, ...children) => ({ tag, props, children })

test('GFM becomes portable semantic elements, not HTML strings', () => {
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

test('untrusted markup and URLs never become executable nodes', () => {
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

test('a document is its blocks in an element of its own', () => {
  let tokens = parse('# Title\n\nwords')
  assertEquals(render(tokens, tree), {
    tag: 'div',
    props: { class: 'Markdown', wrap: '1' },
    children: blocks(tokens, tree),
  })
  assertEquals(blocks(tokens, tree).map((b) => (b as Tree).tag), ['h1', 'p'])
})

test('Preact component produces ordinary web-compatible elements', () => {
  let ui = mount(h(Markdown, { source: '**hello**' }))
  try {
    assertEquals(
      ui.root.querySelector('div.Markdown strong')?.textContent,
      'hello',
    )
  } finally {
    ui.free()
  }
})

// What a reader sees of the ids in some prose: each link as `[words](href)`,
// the rest as its text, under a host that opens every id at `/id` but the ones
// named `X-…`, which this reader cannot open.
let opens = (id: string) => id.startsWith('X-') ? undefined : '/' + id
let seen = (
  source: string,
  host: Options = { refs: opens },
) => {
  let ui = mount(h(Host.Provider, { value: host }, h(Markdown, { source })))
  try {
    let p = ui.root.querySelector('.Markdown')!
    for (let a of [...p.querySelectorAll('a')]) {
      a.replaceWith(
        `[${a.textContent}](${a.getAttribute('href')}${
          a.getAttribute('data-ref') ? '' : ' unnamed'
        })`,
      )
    }
    return p.textContent
  } finally {
    ui.free()
  }
}

test('an entity id in prose links where the host can open it', () => {
  let uuid = '352e9920-08ae-436c-94e2-14bd02a37b2d'
  let sha = '83f7b7460'.padEnd(40, 'a')
  for (
    let [source, want] of [
      ['see T-123 and D-4.', 'see [T-123](/T-123) and [D-4](/D-4).'],
      ['short #18bc9a78d1 here', 'short [#18bc9a78d1](/#18bc9a78d1) here'],
      [`full ${uuid}`, 'full [#352e992008](/#352e992008)'],
      [`[it](${uuid})`, '[it](/#352e992008)'],
      [`commit ${sha}`, `commit [${sha}](/${sha})`],
      ['[the plan](M-31946)', '[the plan](/M-31946)'],
      ['quoted `83f7b74`', 'quoted [83f7b74](/83f7b74)'],
      ['**C-9** in bold', '[C-9](/C-9) in bold'],
      ['not X-1 for you', 'not X-1 for you'],
      ['xT-1 is a word', 'xT-1 is a word'],
      ['UTF-8, SHA-256, AT-1x, `T-5`', 'UTF-8, SHA-256, AT-1x, T-5'],
      ['`decafed` and decafbad', '[decafed](/decafed) and decafbad'],
      ['[out](https://a.b/T-1)', '[out](https://a.b/T-1 unnamed)'],
    ]
  ) assertEquals(seen(source), want, source)
  // A host that gives no way to open entities leaves every id as its words.
  assertEquals(seen('T-1 and [it](T-2)', {}), 'T-1 and it')
  assertEquals(seen(`one ${uuid}`, {}), 'one #352e992008')
})

let PROJECT = '352e9920-08ae-436c-94e2-14bd02a37b2d'
let TASK = '0e513227-de00-4000-8000-000000000001'
let ids = (eid: string) => eid == PROJECT ? 'P-1' : undefined

test('an eid in prose is drawn as the id its host has at hand, or its handle', () => {
  for (
    let [source, want] of [
      [`see ${PROJECT}.`, 'see [P-1](/P-1).'],
      [`and ${TASK}`, 'and [#0e513227de](/#0e513227de)'],
      [`[the plan](${PROJECT})`, '[the plan](/P-1)'],
    ]
  ) assertEquals(seen(source, { refs: opens, ids }), want, source)
})

test('prose drawn as text holds no whole uuid outside code', () => {
  for (
    let [source, want] of [
      ['no ids, T-12 as typed', 'no ids, T-12 as typed'],
      [`${PROJECT} and ${TASK}`, 'P-1 and #0e513227de'],
      [
        `[the plan](${PROJECT}) [${TASK}](${TASK})`,
        '[the plan](P-1) [#0e513227de](#0e513227de)',
      ],
      [
        `\`${TASK}\` keeps, ${TASK} draws`,
        `\`${TASK}\` keeps, #0e513227de draws`,
      ],
      [
        `\`\`\`\n${PROJECT}\n\`\`\`\n\n- ${PROJECT}`,
        `\`\`\`\n${PROJECT}\n\`\`\`\n\n- P-1`,
      ],
      [`> **${PROJECT}**, | ${TASK} |`, '> **P-1**, | #0e513227de |'],
      [`x${PROJECT} ${PROJECT}y`, `x${PROJECT} ${PROJECT}y`],
    ]
  ) assertEquals(drawn(source, ids), want, source)
})

let eids = (id: string) =>
  ({ 'P-1': PROJECT, 'T-12': TASK, '#0e513227de': TASK })[id]

test('prose is stored with each id it names as that eid, and the rest as typed', () => {
  for (
    let [source, want] of [
      ['P-1 and T-12.', `${PROJECT} and ${TASK}.`],
      [
        '#0e513227de, drawn and written back',
        `${TASK}, drawn and written back`,
      ],
      ['[the plan](P-1) by T-12', `[the plan](${PROJECT}) by ${TASK}`],
      ['[P-1](P-1)', `[${PROJECT}](${PROJECT})`],
      ['`T-12` and\n\n```\nP-1\n```', '`T-12` and\n\n```\nP-1\n```'],
      [
        'T-99, GPT-5, COVID-19, xT-12, T-12a',
        'T-99, GPT-5, COVID-19, xT-12, T-12a',
      ],
      ['#ffcc00 is a colour', '#ffcc00 is a colour'],
      [`${TASK} stays`, `${TASK} stays`],
    ]
  ) assertEquals(stored(source, eids), want, source)
})

test('the ids typed in prose are listed once each, never from code', () => {
  assertEquals(
    typed('T-12, [plan](P-1), `T-7`, T-12 and #0e513227de; #ffcc00'),
    ['T-12', 'P-1', '#0e513227de'],
  )
  assertEquals(typed(`no ids but ${TASK}`), [])
})

test('what a document points at is read the way it is drawn', () => {
  let entity = (id: string) => ({ kind: 'entity', id })
  let link = (href: string) => ({ kind: 'link', href })
  assertEquals(
    mentions(parse(
      'T-1, `T-2`, [plan](D-3), [web](https://x/T-4), `83f7b74`, #abcdef ' +
        '![pic](/p.png) [bad](javascript:x) https://x.test/"quote ' +
        'https://x.test/\\escape https://x.test/clean',
    )),
    [
      entity('T-1'),
      entity('D-3'),
      link('https://x/T-4'),
      entity('83f7b74'),
      entity('#abcdef'),
      link('/p.png'),
      link('https://x.test/clean'),
    ],
  )
})

test('a flat line draws its links, images and ids as their words', () => {
  let ui = mount(
    h(Host.Provider, { value: { refs: opens } }, [
      h(MarkdownInline, {
        source: '**Go** to [the site](https://x.test), T-1, ![a map](/m.png)',
        flat: true,
      }),
    ]),
  )
  try {
    assertEquals(ui.root.querySelector('a'), null)
    assertEquals(ui.root.textContent, 'Go to the site, T-1, a map')
    assertEquals(ui.root.querySelector('strong')?.textContent, 'Go')
  } finally {
    ui.free()
  }
})

test('a host colours code as runs of classed text', () => {
  let tokens = parse('```ts\nlet x\n```')
  let code = (text: string, lang?: string) => [
    { text: text.slice(0, 3), classes: ['hl-' + lang] },
    { text: text.slice(3), classes: [] },
  ]
  let json = JSON.stringify(render(tokens, tree, { code }))
  assert(
    json.includes(
      '{"tag":"span","props":{"class":"hl-ts"},"children":["let"]}',
    ),
    json,
  )
  assert(json.includes('" x"'), json)
})

test('Markdown mounts as safe semantic browser DOM', () => {
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

test('a line of Markdown keeps its inline markup and takes no block', () => {
  let ui = mount(h(MarkdownInline, { source: '# **Train** and `bus`' }))
  try {
    assertEquals(ui.root.querySelector('span')?.textContent, '# Train and bus')
    assertEquals(ui.root.querySelector('strong')?.textContent, 'Train')
    assertEquals(ui.root.querySelector('code')?.textContent, 'bus')
    assertEquals(ui.root.querySelector('p, h1, div.Markdown'), null)
  } finally {
    ui.free()
  }
})

// A heading is a place in a document, so it carries the name that place is
// linked by. `headings` reads the same names out without drawing anything,
// which is what a contents list is built from.
test('headings carry anchor ids a contents list can link', () => {
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
test('a comment is not painted, and markup still is, as text', () => {
  let json = JSON.stringify(
    render(parse('<!-- a note -->\n\nwords <b>bold</b>\n'), tree),
  )
  assert(!json.includes('a note'), json)
  assert(json.includes('<b>'), json)
})

test('explicit source newlines become structural breaks before terminal rendering', () => {
  let tokens = parse('first\n**second**\n\nthird')
  assertEquals(tokens.map((t) => t.type), ['paragraph', 'space', 'paragraph'])
  let first = render([tokens[0]], tree)
  let json = JSON.stringify(first)
  assert(json.includes('"tag":"br"'), json)
  assert(json.includes('"tag":"strong"'), json)
})

test('a soft line break is a space between its two words', () => {
  let words = (source: string) =>
    JSON.stringify(render(parse(source, { breaks: false }), tree))
  assert(words('verdict and\nfindings.').includes('verdict and findings.'))
  assert(words('- the letter \n  filed').includes('the letter filed'))
  assert(!words('a\nb').includes('\\n'))
})
