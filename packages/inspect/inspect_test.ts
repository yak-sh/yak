import { test, tick, until } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { client } from '@yaks/client'
import { desk, draftDoc, drafts } from '@yaks/draft'
import { filters } from '@yaks/filter'
import { docs as fieldDocs } from '@yaks/filter/vocab'
import { mint } from '@yaks/graph'
import { EDGE_URI, edgeKeywords } from '@yaks/edge'
import { print } from '@yaks/tui/print'
import { loadVocab } from '@yaks/vocab'
import { parseHTML } from 'linkedom'
import { type ComponentChild, h, render } from 'preact'
import { Float } from '@yaks/ui'
import { Ux } from '@yaks/ux'
import { docs as uxDocs } from '@yaks/ux/vocab'
import {
  type Answer,
  type Asks,
  type Bundle,
  editing,
  follow,
  frame,
  type Host,
  INSPECT,
  inspector,
  pagePath,
  queryPath,
  STACK,
  views,
} from './mod.ts'
import { docs } from './front.ts'
import { CENSUS } from './census.ts'
import { compEid } from './schema.ts'

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

// A host that answers each line from `answers` and keeps what was asked and
// written, over a page graph of the inspector's own, where what is followed
// is stacked; `draw` hands @yaks/ux a host over it.
type Answers =
  | Record<string, Partial<Answer>>
  | ((line: string) => Partial<Answer> | undefined)

let host = (answers: Answers = {}, edits = true) => {
  let answer = typeof answers == 'function'
    ? answers
    : (l: string) => answers[l]
  let asked: string[] = []
  let applied: Bundle[][] = []
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
          return [k, { rows: [], ready: true, ...answer(line) }]
        }),
      ),
    // A write naming T-404 is refused, as a graph refuses an id that names
    // nothing.
    apply: (change) => {
      applied.push(change)
      if (JSON.stringify(change).includes('T-404')) {
        return Promise.reject(new Error("no entity 'T-404'"))
      }
    },
    get: (eid) => ({ t1: T1, t2: T2 } as Record<string, Bundle>)[eid],
    link: pagePath,
    find: queryPath,
    go: (href) =>
      void front.mutate([
        follow(front.ent(STACK) ?? { entity: { eid: STACK } }, href),
      ]),
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

test('a note under a heading is a comment on the entity that is an open task', async () => {
  using t = host({
    '.comment&.comment.target=t1&.limit=100&*': {
      rows: [{
        entity: { eid: 'c1' },
        doc: {
          title: 'T1 · task: owner should be required',
          body: 'owner should be required',
        },
        comment: { target: 't1' },
        task: {},
      }],
    },
  })
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

test("a row pressed stacks its entity's page on the query's, and the query's strip returns to it", async () => {
  using t = host({
    '.task&.limit=50&*': { rows: [T1, T2] },
    '.task&.count': { count: 2 },
    'entity.eid=t2&*': { rows: [T2] },
  })
  let Page = frame(t.door, {
    fields: t.fields,
    Bar: () => h('input', { name: 'filter' }),
    Scroll: ({ children }) => h('div', {}, children),
  })
  t.io.go(queryPath('.task'))
  using p = mount(t.draw(h(Page, null)))
  let top = '.Stack_Pane'
  assertEquals(
    [...p.root.querySelectorAll(`${top} [role=columnheader]`)].map((th) =>
      th.textContent
    ),
    ['id', 'title', 'task'],
  )
  // linkedom calls a bubbled listener as its target's, so the row is pressed
  // itself
  await p.fire(p.$(`${top} [role=row][data-pick="t2"]`), 'click')
  assert(p.text(`${top} h1`).includes('N-t2'))
  let strips = () => [...p.root.querySelectorAll('.Stack_Strip')]
  assertEquals(strips().map((s) => s.textContent), ['.taskquery'])
  await p.fire(strips()[0], 'click')
  assertEquals(strips(), [])
  assert(p.$(`${top} [role=row][data-pick="t2"]`))
})

test('a query that counts shows the count', () => {
  using t = host({ '.task&.count': { count: 12403 } })
  let Page = frame(t.door, {
    fields: t.fields,
    Bar: () => null,
    Scroll: ({ children }) => h('div', {}, children),
  })
  t.io.go(queryPath('.task&.count'))
  using p = mount(t.draw(h(Page, null)))
  assert(p.text('.Stack_Pane').includes('12,403'))
})

test('the index lists what the vocabulary serves, narrowed by what is typed in its field', async () => {
  using t = host()
  let Page = frame(t.door, {
    fields: t.fields,
    Bar: () => null,
    Scroll: ({ children }) => h('div', {}, children),
  })
  using p = mount(t.draw(h(Page, null)))
  let listed = () =>
    [...p.root.querySelectorAll('[data-pane="index"] .Index_Item')]
      .map((a) => a.textContent)
  assertEquals(listed(), ['comment', 'doc', 'edge', 'requires', 'task'])
  t.fields.type(INSPECT, 're')
  await tick()
  assertEquals(listed(), ['requires'])
  // Each links to the page of the entity the graph describes it in.
  assertEquals(
    p.$('[data-pane="index"] .Index_Item').getAttribute('href'),
    t.io.link(compEid('requires')),
  )
})

test('a terminal paints a page as values, with nothing to type in', () => {
  using t = host({}, false)
  let painted = print(h(t.Door, { e: T1, view: 'Inspect.Page' }), 100)
  for (let word of ['N-t1', 'status', 'open', 'History']) {
    assert(painted.includes(word), word)
  }
  for (let control of ['note', 'edit', '+ component', 'delete']) {
    assert(!painted.includes(control), control)
  }
})
