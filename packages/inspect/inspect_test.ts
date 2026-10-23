import { mount as terminalMount } from '../tui/testing.ts'
import { TElement } from '@yaks/tui'
import { everforest, kits, sheet as uiSheet } from '@yaks/ui'
import { Grid } from './grid.ts'
import { linkOf, stops } from './terminal-links.ts'
import { test, tick, until } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { client } from '@yaks/client'
import { desk, draftDoc, drafts } from '@yaks/draft'
import { filters } from '@yaks/filter'
import { docs as fieldDocs } from '@yaks/filter/vocab'
import { mint } from '@yaks/graph'
import { matcher } from '@yaks/match'
import { EDGE_URI, edgeKeywords } from '@yaks/edge'
import { print } from '@yaks/tui/print'
import { loadVocab } from '@yaks/vocab'
import { parseHTML } from 'linkedom'
import { renderToString } from 'preact-render-to-string'
import { type ComponentChild, h, render } from 'preact'
import { Float } from '@yaks/ui'
import { Ux } from '@yaks/ux'
import { docs as uxDocs } from '@yaks/ux/vocab'
import {
  type Answer,
  type Asks,
  type Bundle,
  editing,
  type Host,
  inspector,
  Past,
  views,
} from './mod.ts'
import { docs } from './front.ts'
import { compEid, propEid } from './schema.ts'
let pagePath = (id: string) => `/${id}`

import { CENSUS } from './census.ts'

// A graph of tasks, their owners and the edges between them.
let vocab = loadVocab([{
  $vocabulary: { [EDGE_URI]: true },
  package: '@t/tasks',
  $defs: {
    doc: {
      component: true,
      properties: { title: { type: 'string' }, body: { type: 'string' } },
    },
    task: {
      component: true,
      description: 'Work to be done.',
      properties: {
        status: { type: 'string', enum: ['open', 'done'] },
        owner: { type: 'string', ref: 'entity' },
        seen: { type: 'string', stamped: true },
      },
    },
    comment: {
      component: true,
      properties: { target: { type: 'string', ref: 'entity' } },
    },
    edge: {
      component: true,
      properties: {
        from: { type: 'string', ref: 'entity' },
        to: { type: 'string', ref: 'entity' },
      },
    },
    requires: { component: true, edge: 'edge', properties: {} },
  },
}], [edgeKeywords])

let P1 = '0190a1b2-0000-7000-8000-000000000001'
let T1: Bundle = {
  entity: { eid: 't1', num: 1 },
  doc: { title: 'Fix the map' },
  task: { status: 'open', owner: P1, seen: 'yesterday' },
}
let T2: Bundle = {
  entity: { eid: 't2', num: 2 },
  doc: { title: 'Draw the map' },
  task: { status: 'done' },
}
let TASK: Bundle = {
  entity: { eid: 'c-task' },
  _comp: { name: 'task' },
  doc: { title: 'task', body: 'Work to be done.' },
}

let CLOSE: Bundle = {
  entity: { eid: 'e-close' },
  _effect: {
    name: 'task_close',
    created: ['task'],
    changed: ['task.status'],
    target: '.task',
    tries: 3,
  },
  doc: { title: 'task_close', body: 'Close the task when it is done.' },
}

// A host that answers each line from `answers`, or by matching it over a
// graph of bundles, holds the rows it answered, as a page does what its
// asks brought in, and keeps what was asked and written, over a page graph of
// the inspector's own, where what is followed is stacked; `draw` hands
// @yaks/ux a host over it.
type Answers =
  | Record<string, Partial<Answer>>
  | ((line: string) => Partial<Answer> | undefined)
  | Bundle[]

let host = (answers: Answers = {}, edits = true) => {
  let answer = typeof answers == 'function'
    ? answers
    : Array.isArray(answers)
    ? (l: string) => ({ rows: matcher(l, vocab)(answers) })
    : (l: string) => answers[l]
  let asked: string[] = []
  let applied: Bundle[][] = []
  let held = new Map<string, Bundle>()
  let front = client(loadVocab([...docs, ...uxDocs]), [], { vault: false })
  let double: Host = {
    vocab,
    front,
    edits,
    useAnswers: (asks: Asks) =>
      Object.fromEntries(
        Object.entries(asks).map(([k, a]) => {
          let line = typeof a == 'string' ? a : a.query
          asked.push(line)
          let got = { rows: [], ready: true, ...answer(line) }
          for (let b of got.rows) held.set(b.entity.eid, b)
          return [k, got]
        }),
      ),
    // A write naming T-404 is refused, as a graph refuses an id that names
    // nothing.
    apply: (bundles) => {
      applied.push(bundles)
      if (JSON.stringify(bundles).includes('T-404')) {
        return Promise.reject(new Error("no entity 'T-404'"))
      }
    },
    get: (eid) =>
      ({ t1: T1, t2: T2 } as Record<string, Bundle>)[eid] ?? held.get(eid),
    link: pagePath,
    past: (eid, tx) => `${pagePath(eid)}?at=${tx}`,
    find: (q) => `/?q=${encodeURIComponent(q)}`,
    go: (_href) => {},
    id: (b) => b.entity.eid.toUpperCase(),
    kind: (b) => b.task ? 'task' : 'entity',
    name: (eid) => `N-${eid}`,
    when: (at) => at,
  }
  let door = inspector(views, double)
  // What is typed waits as drafts in a page graph beside it, the query
  // fields' own.
  let typer = mint()
  let page = client(loadVocab([...fieldDocs, draftDoc]), [drafts()], {
    vault: false,
  })
  let drafted = desk(page, { by: () => typer })
  let fields = filters(page, { vocab, drafts: drafted })
  let ux = editing(double, {
    find: () => Promise.resolve([T2]),
    drafts: drafted,
    Float,
  })
  return {
    asked,
    applied,
    front,
    fields,
    ...door,
    door,
    draw: (node: ComponentChild) => h(Ux, { host: ux }, node),
    [Symbol.dispose]: () => {},
  }
}

// A page mounted in a document: its root, and a way to fire an event. It has
// a body and a viewport, for what floats above it.
let mount = (node: ComponentChild) => {
  let { document, window } = parseHTML(
    '<html><body><main></main></body></html>',
  )
  let root = document.querySelector('main')!
  let globals: Record<string, unknown> = {
    document,
    innerWidth: 1000,
    innerHeight: 800,
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  }
  let prior = Object.keys(globals).map((k) =>
    [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const
  )
  for (let [k, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, k, { value, configurable: true })
  }
  render(node, root)
  let fire = async (el: Element, type: string, key?: string) => {
    let ev = new window.Event(type, { bubbles: true, cancelable: true })
    if (key) Object.defineProperty(ev, 'key', { value: key })
    el.dispatchEvent(ev)
    await tick()
  }
  let $ = <T extends Element = HTMLElement>(s: string) =>
    root.querySelector<T>(s)!
  let text = (s: string) => root.querySelector(s)?.textContent ?? ''
  let free = () => {
    render(null, root)
    for (let [k, d] of prior) {
      if (d) Object.defineProperty(globalThis, k, d)
      else delete (globalThis as Record<string, unknown>)[k]
    }
  }
  return { root, fire, $, text, [Symbol.dispose]: free }
}

// The value on the page that reads `text`.
let value = (p: ReturnType<typeof mount>, text: string) =>
  [...p.root.querySelectorAll<HTMLElement>('.Prop_Val')]
    .find((v) => v.textContent?.includes(text))

// A value typed over where it stands: pressed, typed, then Enter.
let type = async (p: ReturnType<typeof mount>, was: string, to: string) => {
  await p.fire(value(p, was)!, 'click')
  let edit = await until(() =>
    p.root.querySelector<HTMLElement>('.Prop .Edit[contenteditable]')
  )
  assertEquals(edit.textContent, was)
  edit.textContent = to
  await p.fire(edit, 'keydown', 'Enter')
}

// The press on a page's head that turns its controls on.
let edit = (p: ReturnType<typeof mount>) =>
  p.fire(
    [...p.root.querySelectorAll('button')].find((b) =>
      b.textContent == 'edit'
    )!,
    'click',
  )

test('an entity page is read, its references by name, until the reader asks to edit it', async () => {
  using t = host()
  using p = mount(t.draw(h(t.Door, { e: T1, view: 'Inspect.Page' })))
  assert(p.text('h1').includes('N-t1'))
  assertEquals(p.text(`[data-facts] a[href="${pagePath(P1)}"]`), `N-${P1}`)
  assert(p.text('[data-facts]').includes('open'))
  // Nothing is offered to type over, nor to remove, until it is asked for.
  assertEquals(value(p, 'open'), undefined)
  assertEquals(p.root.querySelector('[aria-label="remove task"]'), null)
  await edit(p)
  assert(value(p, 'open'))
  assert(p.root.querySelector('[aria-label="remove task"]'))
})

test('an entity page, edited, writes a value typed over in place', async () => {
  using t = host()
  using p = mount(t.draw(h(t.Door, { e: T1, view: 'Inspect.Page' })))
  await edit(p)
  assert(value(p, 'Fix the map'))
  assert(p.text('[data-section="task"]').includes('Work to be done.'))
  // What the server owns is shown, never offered.
  assert(p.text('[data-section="task"]').includes('yesterday'))
  assertEquals(value(p, 'yesterday'), undefined)
  // A reference reads as what it names, linked.
  assertEquals(p.text(`a[href="${pagePath(P1)}"]`), `N-${P1}`)
  await type(p, 'Fix the map', 'Fix the whole map')
  assertEquals(t.applied.at(-1), [{
    entity: { eid: 't1' },
    doc: { title: 'Fix the whole map' },
  }])
  // A closed set's choices float beside the value.
  await p.fire(value(p, 'open')!, 'click')
  let done = [...p.root.ownerDocument!.querySelectorAll<HTMLElement>(
    '.Overlay .Prop_Tab',
  )].find((b) => b.textContent == 'done')!
  await p.fire(done, 'click')
  assertEquals(t.applied.at(-1), [{
    entity: { eid: 't1' },
    task: { status: 'done' },
  }])
  // A write the graph refuses is said under the entity's head.
  await type(p, 'Fix the map', 'T-404')
  await tick()
  assertEquals(p.text('.Head_Sub-refused'), "no entity 'T-404'")
})

// A note on T1 under its task heading, and a comment on T1 that is no note.
let NOTE: Bundle = {
  entity: { eid: 'c1' },
  doc: {
    title: 'T1 · task: owner should be required',
    body: 'owner should be required',
  },
  comment: { target: 't1' },
  task: {},
}
let SAID: Bundle = {
  entity: { eid: 'c2' },
  doc: { title: 'looks right to me', body: 'looks right to me' },
  comment: { target: 't1' },
}

// Query answers are fixtures; each case still renders its own page through
// the inspector, including the combined page's duplicate suppression.
let commentHost = (comments: Bundle[]) =>
  host({
    '.comment&.task&.comment.target=t1&.limit=100&*': {
      rows: comments.filter((b) => b.task),
    },
    '.refs=t1&.limit=200': { rows: comments },
    '.entity.eid=c2': { rows: comments.filter((b) => b.entity.eid == 'c2') },
  })
// Only the task heading is relevant to comment placement, not its owner,
// status fields or document prose. Render the same minimal page in all cases.
let commentPage: Bundle = { entity: T1.entity, task: {} }
let commented = commentHost([NOTE, SAID])
let noted = commentHost([NOTE])
let said = commentHost([SAID])

test('a comment is drawn once on its page even when notes and other comments coexist', () => {
  let t = commented
  let page = renderToString(
    h(t.Door, { e: { entity: T1.entity }, view: 'Inspect.Page' }),
  )
  let drawn = (eid: string) =>
    page.split(`<a href="${pagePath(eid)}">`).length - 1
  assertEquals(drawn('c1'), 1)
  assertEquals(drawn('c2'), 1)
})

test('a note is drawn under its heading before the page links', () => {
  let t = noted
  let page = renderToString(h(t.Door, { e: commentPage, view: 'Inspect.Page' }))
  let [facts] = page.split('data-section="Links"')
  assert(facts.includes('owner should be required'))
})

test('a comment that is not a note is drawn among the page links', () => {
  let t = said
  let page = renderToString(h(t.Door, { e: commentPage, view: 'Inspect.Page' }))
  let [, links] = page.split('data-section="Links"')
  assert(links.includes(`<a href="${pagePath('c2')}">N-c2</a>`))
})

test('a note under a heading is a comment on the entity that is an open task', async () => {
  using t = host([T1, NOTE])
  using p = mount(t.draw(h(t.Door, { e: T1, view: 'Inspect.Page' })))
  assert(p.text('[data-facts]').includes('owner should be required'))
  await edit(p)
  assert(p.text('[data-section="task"]').includes('owner should be required'))
  assert(!p.text('[data-section="doc"]').includes('owner should be required'))
  await p.fire(
    p.$('[data-section="task"] [aria-label="note on task"]'),
    'click',
  )
  let field = p.$<HTMLInputElement>('[data-section="task"] [name=note]')
  field.value = 'status wants a third value'
  await p.fire(field.closest('form')!, 'submit')
  assertEquals(t.applied.at(-1), [{
    entity: { eid: '$note' },
    doc: {
      title: 'T1 · task: status wants a third value',
      body: 'status wants a third value',
    },
    comment: { target: 't1' },
    task: {},
  }])
  assertEquals(p.root.querySelector('[name=note]'), null)
})

test('an edge is added by its relation and far end, and its × removes it', async () => {
  let edge = {
    entity: { eid: 'e1' },
    edge: { from: 't1', to: 't2' },
    requires: {},
  }
  using t = host({ '.refs=t1&.limit=200': { rows: [edge] } })
  using p = mount(t.draw(h(t.Door, { e: T1, view: 'Inspect.Page' })))
  assert(p.text('[data-section="Links"]').includes('requires'))
  assertEquals(
    p.text(`[data-section="Links"] a[href="${pagePath('t2')}"]`),
    'N-t2',
  )
  await edit(p)
  await p.fire(p.$('[aria-label="remove this requires edge"]'), 'click')
  assertEquals(t.applied.at(-1), [{ entity: { eid: 'e1' }, $delete: true }])
  // linkedom selects no first option, as a browser does
  Object.defineProperty(p.$('[name=relation]'), 'value', { value: 'requires' })
  let to = p.$<HTMLInputElement>('[name=to]')
  to.value = 'T-2'
  await p.fire(to.closest('form')!, 'submit')
  assertEquals(t.applied.at(-1), [{
    entity: { eid: '$edge' },
    edge: { from: 't1', to: 'T-2' },
    requires: {},
  }])
  // An end that names nothing is refused, and the part says why.
  to.value = 'T-404'
  await p.fire(to.closest('form')!, 'submit')
  await tick()
  assert(p.text('[data-section="Links"]').includes("no entity 'T-404'"))
})

test("a component's entities run by a pressed heading, a page at a time", async () => {
  let page = Array.from({ length: 50 }, (_, i) => ({
    entity: { eid: `t${i}` },
    task: { status: 'open' },
  }))
  using t = host((line) =>
    line.endsWith('&.limit=50')
      ? { rows: page }
      : line == CENSUS.sets
      ? { rows: [{ entity: { eid: 'a' }, archetype: { tables: '["task"]' } }] }
      : line == CENSUS.tally
      ? { tally: { a: 120 } }
      : undefined
  )
  using p = mount(t.draw(h(t.Door, { e: TASK, view: 'Inspect.Page' })))
  let heading = () =>
    p.root.querySelectorAll('[data-section="Entities"] [role=columnheader]')[1]
  let last = () => t.asked.filter((l) => l.endsWith('&.limit=50')).at(-1)
  assertEquals(heading().textContent, 'status')
  await p.fire(heading(), 'click')
  assertEquals(last(), '.task&.order=task.status&.limit=50')
  await p.fire(heading(), 'click')
  assertEquals(last(), '.task&.order=-task.status&.limit=50')
  await p.fire(heading(), 'click')
  assertEquals(last(), '.task&.limit=50')
  assert(p.text('[data-section="Entities"] .Pager').includes('1–50 of 120'))
  let [, next] = p.root.querySelectorAll(
    '[data-section="Entities"] .Pager_Step',
  )
  await p.fire(next, 'click')
  assertEquals(last(), '.task&.after=t49&.limit=50')
})

let queryPage = (text: string, rows = [T1, T2]) => {
  using t = host((line) => line.endsWith('&.count') ? { count: 120 } : { rows })
  using p = mount(t.draw(h(t.Door, {
    e: { entity: { eid: 'query' } },
    view: 'Inspect.Query',
    ctx: { query: text },
  })))
  return {
    asked: t.asked,
    rows: p.root.querySelectorAll('.Table_Body .Table_Row').length,
    pager: p.root.querySelector('.Pager')?.textContent,
    text: p.root.textContent,
  }
}
let ownedQueries = ['.task&.limit=20', '.task&.order=doc.title'].map((
  text,
) => ({ text, page: queryPage(text) }))
let unboundedQuery = queryPage(
  '.task',
  Array.from({ length: 50 }, (_, i) => ({
    entity: { eid: `query-row-${i}` },
    doc: { title: `Row ${i}` },
    task: { status: 'open', owner: P1, seen: 'yesterday' },
  })),
)
for (let { text, page } of ownedQueries) {
  test(`a query's own window paints its rows without asking for an unused count (${text})`, () => {
    assertEquals(page.asked.filter((line) => line.endsWith('&.count')), [])
    assert(page.asked.includes(text + '&*'))
    assertEquals(page.rows, 2)
    assertEquals(page.pager, undefined)
    assert(page.text?.includes('Fix the map'))
    assert(page.text?.includes('Draw the map'))
  })
}

test('a query without its own window keeps the count used by its pager', () => {
  assert(unboundedQuery.asked.includes('.task&.count'))
  assert(unboundedQuery.asked.includes('.task&.limit=50&*'))
  assertEquals(unboundedQuery.rows, 50)
  assert(unboundedQuery.pager?.includes('1–50 of 120'))
})

test('a query that counts shows the count through its view registration', () => {
  using t = host({ '.task&.count': { count: 12403 } })
  using p = mount(
    t.draw(
      h(t.Door, {
        e: { entity: { eid: 'query' } },
        view: 'Inspect.Query',
        ctx: { query: '.task&.count' },
      }),
    ),
  )
  assert(p.root.textContent?.includes('12,403'))
})

test("an effect's page says what owes it a run, each name linked to its page", () => {
  using t = host()
  let page = renderToString(h(t.Door, { e: CLOSE, view: 'Inspect.Page' }))
  for (
    let said of [
      'Close the task when it is done.',
      '3 tries',
      `href="/${compEid('task')}"`,
      `href="/${propEid('task', 'status')}"`,
      `href="/?q=.task"`,
    ]
  ) assert(page.includes(said), said)
})

test('a terminal paints a page as values, with nothing to type in', () => {
  using t = host({}, false)
  let painted = print(h(t.Door, { e: T1, view: 'Inspect.Page' }), 100)
  for (let word of ['N-t1', 'status', 'open']) {
    assert(painted.includes(word), word)
  }
  for (let control of ['note', 'edit', '+ component', 'delete']) {
    assert(!painted.includes(control), control)
  }
})

test('terminal clicks inside a pickable row follow the link, not the row', async () => {
  using t = host({}, false)
  let followed: string[] = []
  let io = {
    ...t.io,
    go: (href: string) => {
      followed.push(href)
    },
  }
  let ui = await terminalMount(
    () =>
      h(
        'div',
        {
          onClick: (e: { target: TElement }) => {
            let href = linkOf(e.target)
            if (href) io.go(href)
          },
        },
        h(Grid, {
          io,
          id: 'probe',
          rows: [T1],
          local: true,
          columns: [{
            name: 'target',
            cell: () =>
              h('a', { href: pagePath('t2') }, h('span', {}, 'other')),
          }, { name: 'title', cell: () => 'row body' }],
        }),
      ),
    40,
    5,
    uiSheet({ kits, theme: everforest }),
  )
  try {
    assert(ui.text().includes('other'))
    await ui.send('\x1b[<0;2;2M\x1b[<0;2;2m')
    assertEquals(followed, [pagePath('t2')])
    await ui.send('\x1b[<0;10;2M\x1b[<0;10;2m')
    assertEquals(followed, [pagePath('t2'), pagePath('t1')])
  } finally {
    ui.free()
  }
})

test('terminal walk visits a row then each of its links before the next row', async () => {
  let visited: string[] = []
  let ui = await terminalMount(() =>
    h(
      'div',
      {
        ref: (root: TElement | null) => {
          if (root) {
            visited = stops(root).map((el) =>
              el.attr('data-pick') ?? el.attr('href')!
            )
          }
        },
      },
      h(
        'div',
        { 'data-pick': 'row1' },
        h('a', { href: '/first' }, 'first'),
        h('span', {}, h('a', { href: '/second' }, 'second')),
      ),
      h('div', { 'data-pick': 'row2' }, 'next'),
    )
  )
  try {
    assertEquals(visited, ['row1', '/first', '/second', 'row2'])
  } finally {
    ui.free()
  }
})

test('an inspector without a journal never asks for history', () => {
  using t = host()
  using p = mount(t.draw(h(t.Door, { e: T1, view: 'Inspect.Page' })))
  assertEquals(
    t.asked.some((q) => q.includes('._change') || q.includes('._tx')),
    false,
  )
  assertEquals(p.root.textContent?.includes('History'), false)
})

// A memory written twice, then deleted, told by its history.
let change = (eid: string, tx: string, comp: string, value?: object) => ({
  entity: { eid },
  _change: { tx, target: 'gone', comp, ...value ? { value } : {} },
})
let gone = (l: string): Partial<Answer> | undefined =>
  l.startsWith('._change&')
    ? {
      rows: [
        change('c1', 'x1', 'cd', { title: 'Plan', body: 'The first body.' }),
        change('c2', 'x2', 'cd', { body: 'The second body.' }),
        change('c3', 'x3', 'ce'),
      ],
    }
    : l.startsWith('._comp&')
    ? {
      rows: [
        { entity: { eid: 'cd' }, _comp: { name: 'doc' } },
        { entity: { eid: 'ce' }, _comp: { name: 'entity' } },
      ],
    }
    : l.startsWith('._tx&')
    ? {
      rows: ['x1', 'x2', 'x3'].map((x) => ({
        entity: { eid: x },
        _tx: { at: `at ${x}`, by: 't1' },
      })),
    }
    : undefined

// The past page of the deleted memory, as of `at`: its head and body, and the
// versions its history opens.
let past = (at?: string) => {
  using t = host(gone)
  using p = mount(t.draw(h(Past, {
    e: { entity: { eid: 'gone' } },
    io: t.io,
    id: 'M-9',
    at,
    lost: h('p', {}, 'lost'),
  })))
  return {
    head: p.text('.Head').replace(/\s+/g, ' '),
    body: p.text('.Body'),
    opens: [...p.root.querySelectorAll('a')].map((a) => a.getAttribute('href'))
      .filter((x) => x?.includes('?at=')),
  }
}
let deleted = past()
let first = past('x1')
let never = past('x9')

test('a deleted entity reads as it was last, deleted when and by whom', () => {
  assert(deleted.head.includes('Plan'), deleted.head)
  assert(deleted.head.includes('deleted at x3 by N-t1'), deleted.head)
  assertEquals(deleted.body, 'The second body.')
})

test('each moment of a history but its deletion opens its version', () => {
  assertEquals(deleted.opens, ['/gone?at=x2', '/gone?at=x1'])
})

test('a version reads what its entity held just after that transaction', () => {
  assert(first.head.includes('as it was at x1'), first.head)
  assertEquals(first.body, 'The first body.')
})

test('a version its history never held is lost', () => {
  assertEquals(never, { head: '', body: '', opens: [] })
})
