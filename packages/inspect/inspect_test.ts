import { test, tick } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { client } from '@yaks/client'
import { EDGE_URI, edgeKeywords } from '@yaks/edge'
import { print } from '@yaks/tui/print'
import { loadVocab } from '@yaks/vocab'
import { parseHTML } from 'linkedom'
import { type ComponentChild, h, render } from 'preact'
import {
  type Answer,
  type Asks,
  type Bundle,
  frame,
  type Host,
  inspector,
  views,
} from './mod.ts'
import { docs } from './front.ts'

// A graph of tasks, their owners and the edges between them.
let vocab = loadVocab([{
  $vocabulary: { [EDGE_URI]: true },
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

// A host that answers each line from `answers` and keeps what was asked,
// written and picked, over a page graph of the inspector's own.
type Answers =
  | Record<string, Partial<Answer>>
  | ((line: string) => Partial<Answer> | undefined)

let host = (answers: Answers = {}, edits = true) => {
  let answer = typeof answers == 'function'
    ? answers
    : (l: string) => answers[l]
  let asked: string[] = []
  let applied: Bundle[][] = []
  let front = client(loadVocab(docs), [], { vault: false })
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
    get: () => undefined,
    link: (eid) => `/${eid}`,
    find: (q) => `/inspect?q=${q}`,
    pick: (eid) =>
      void front.mutate([{
        entity: { eid: 'inspect' },
        inspector: { detail: eid },
      }]),
    id: (b) => b.entity.eid.toUpperCase(),
    kind: (b) => b.task ? 'task' : 'entity',
    name: (eid) => `N-${eid}`,
    when: (at) => at,
  }
  let door = inspector(views, double)
  return { asked, applied, front, ...door, door }
}

// A page mounted in a document: its root, and a way to fire an event.
let mount = (node: ComponentChild) => {
  let { document, window } = parseHTML('<main></main>')
  let root = document.querySelector('main')!
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
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
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
  return { root, fire, $, text, [Symbol.dispose]: free }
}

// A value typed over where it stands: pressed, typed, then Enter.
let type = async (p: ReturnType<typeof mount>, label: string, to: string) => {
  await p.fire(p.$(`[aria-label="${label}"]`), 'click')
  let v = p.$(`[aria-label="${label}"]`)
  assert(v.className.includes('Value-editing'))
  v.textContent = to
  await p.fire(v, 'keydown', 'Enter')
}

test('an entity page shows each component and writes a value typed over in place', async () => {
  let t = host()
  using p = mount(h(t.Door, { e: T1, view: 'Inspect.Page' }))
  assertEquals(p.text('[aria-label="doc.title"]'), 'Fix the map')
  assert(p.text('[data-section="task"]').includes('Work to be done.'))
  // What the server owns is shown, never offered.
  assert(p.text('[data-section="task"]').includes('yesterday'))
  assertEquals(p.root.querySelector('[aria-label="task.seen"]'), null)
  // A reference reads as what it names, linked.
  assertEquals(p.text(`a[href="/${P1}"]`), `N-${P1}`)
  await type(p, 'doc.title', 'Fix the whole map')
  assertEquals(t.applied.at(-1), [{
    entity: { eid: 't1' },
    doc: { title: 'Fix the whole map' },
  }])
  assert(!p.$('[aria-label="doc.title"]').className.includes('Value-editing'))
  // A value the graph refuses stays marked, saying why.
  await type(p, 'task.owner', 'T-404')
  await tick()
  let owner = p.$('[aria-label="task.owner"]')
  assert(owner.className.includes('Value-refused'))
  assertEquals(owner.getAttribute('title'), "no entity 'T-404'")
})

test('a note under a heading is a comment on the entity that is an open task', async () => {
  let t = host({
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
  using p = mount(h(t.Door, { e: T1, view: 'Inspect.Page' }))
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
  let t = host({ '.refs=t1&.limit=200': { rows: [edge] } })
  using p = mount(h(t.Door, { e: T1, view: 'Inspect.Page' }))
  assertEquals(p.text('[data-section="Edges"] a[href="/t2"]'), 'N-t2')
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
  assert(p.text('[data-section="Edges"]').includes("no entity 'T-404'"))
})

test("a component's entities run by a pressed heading, a page at a time", async () => {
  let page = Array.from({ length: 50 }, (_, i) => ({
    entity: { eid: `t${i}` },
    task: { status: 'open' },
  }))
  let t = host((line) =>
    line.endsWith('&.limit=50')
      ? { rows: page }
      : line == '.task&.count'
      ? { count: 120 }
      : undefined
  )
  using p = mount(h(t.Door, { e: TASK, view: 'Inspect.Page' }))
  let heading = () => p.root.querySelectorAll('[data-section="Entities"] th')[1]
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

test('a query shows its rows by the components they share; a row pressed opens beside it', async () => {
  let t = host({
    '.task&.limit=50&*': { rows: [T1, T2] },
    '.task&.count': { count: 2 },
    'entity.eid=t2&*': { rows: [T2] },
  })
  let Page = frame(t.door, {
    Bar: () => h('input', { name: 'filter' }),
    Scroll: ({ children }) => h('div', {}, children),
  })
  using p = mount(h(Page, { where: { query: '.task' } }))
  let pane = (name: string) => `[data-pane="${name}"]`
  assertEquals(
    [...p.root.querySelectorAll(`${pane('page')} th`)].map((th) =>
      th.textContent
    ),
    ['id', 'title', 'task'],
  )
  assert(p.text(pane('detail')).includes('Press a row'))
  // linkedom calls a bubbled listener as its target's, so the row is pressed
  // itself
  await p.fire(p.$(`${pane('page')} tr[data-pick="t2"]`), 'click')
  assert(p.text(`${pane('detail')} h1`).includes('N-t2'))
  assert(
    p.$(`${pane('page')} tr[data-pick="t2"]`).className.includes(
      'Table_Row-on',
    ),
  )
})

test('a query that counts shows the count', () => {
  let t = host({ '.task&.count': { count: 12403 } })
  let Page = frame(t.door, {
    Bar: () => null,
    Scroll: ({ children }) => h('div', {}, children),
  })
  using p = mount(h(Page, { where: { query: '.task&.count' } }))
  assert(p.text('[data-pane="page"]').includes('12,403'))
})

test('a terminal paints a page as values, with nothing to type in', () => {
  let t = host({}, false)
  let painted = print(h(t.Door, { e: T1, view: 'Inspect.Page' }), 100)
  for (let word of ['Fix the map', 'status', 'open', 'Edges', 'History']) {
    assert(painted.includes(word), word)
  }
  for (let control of ['note', '+ component', 'delete']) {
    assert(!painted.includes(control), control)
  }
})
