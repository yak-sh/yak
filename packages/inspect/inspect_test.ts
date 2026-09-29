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
  type Host,
  inspector,
  MAP,
  opened,
  views,
} from './mod.ts'
import { docs } from './vocab.ts'

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

let T1: Bundle = {
  entity: { eid: 't1', num: 1 },
  doc: { title: 'Fix the map' },
  task: { status: 'open', owner: 'p1', seen: 'yesterday' },
}

// A host that answers each line from `answers` and keeps what was asked and
// written, over a page graph of the inspector's own.
let host = (answers: Record<string, Partial<Answer>> = {}, edits = true) => {
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
          return [k, { rows: [], ready: true, ...answers[line] }]
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
    id: (b) => b.entity.eid.toUpperCase(),
    kind: (b) => b.task ? 'task' : 'entity',
    name: (eid) => `N-${eid}`,
    when: (at) => at,
    Bar: ({ id }) => h('input', { class: 'Bar', 'data-id': id }),
  }
  return {
    host: double,
    asked,
    applied,
    front,
    ...inspector(views, double),
  }
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
  let fire = (el: Element, type: string) =>
    el.dispatchEvent(
      new window.Event(type, { bubbles: true, cancelable: true }),
    )
  let free = () => {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
  return { root, fire, free }
}

test('an entity page shows every value and writes an edit as a patch', async () => {
  let t = host()
  let p = mount(h(t.Door, { e: T1, view: 'Inspect.Full' }))
  try {
    let title = p.root.querySelector<HTMLInputElement>(
      '[aria-label="doc.title"]',
    )!
    assertEquals(title.value, 'Fix the map')
    title.value = 'Fix the whole map'
    p.fire(title, 'change')
    await tick()
    assertEquals(t.applied, [[{
      entity: { eid: 't1' },
      doc: { title: 'Fix the whole map' },
    }]])
    // What the server owns is shown, never offered.
    assertEquals(p.root.querySelector('[aria-label="task.seen"]'), null)
    assert(p.root.textContent!.includes('yesterday'))
    // A reference reads as what it names, linked.
    assert(p.root.querySelector('a[href="/p1"]')?.textContent == 'N-p1')
  } finally {
    p.free()
  }
})

test('a folded section asks nothing, and unfolding it asks again', async () => {
  let t = host()
  let p = mount(h(t.Door, { e: T1, view: 'Inspect.Full' }))
  try {
    let refs = '.refs=t1&.limit=200'
    assert(t.asked.includes(refs))
    p.fire(p.root.querySelector('[aria-label="fold Links"]')!, 'click')
    await tick()
    t.asked.length = 0
    render(h(t.Door, { e: { ...T1 }, view: 'Inspect.Full' }), p.root)
    assert(!t.asked.includes(refs))
    assert(p.root.querySelector('[aria-label="unfold Links"]'))
  } finally {
    p.free()
  }
})

test('feedback on a part is a comment on it that is an open task', async () => {
  let t = host({
    '.comment&.comment.target=t1&.limit=100': {
      rows: [{
        entity: { eid: 'c1' },
        doc: { body: 'the owner should be required' },
        comment: { target: 't1' },
        task: {},
      }],
    },
  })
  let p = mount(h(t.Door, { e: T1, view: 'Inspect.Full' }))
  try {
    assert(p.root.textContent!.includes('the owner should be required'))
    let say = p.root.querySelector<HTMLTextAreaElement>('[name=body]')!
    say.value = 'status wants a third value'
    p.fire(say.closest('form')!, 'submit')
    await tick()
    assertEquals(t.applied.at(-1), [{
      entity: { eid: '$feedback' },
      doc: {
        title: 'N-t1: status wants a third value',
        body: 'status wants a third value',
      },
      comment: { target: 't1' },
      task: {},
    }])
  } finally {
    p.free()
  }
})

test('an edge is added by its relation and far end, and its × removes it', async () => {
  let edge = {
    entity: { eid: 'e1' },
    edge: { from: 't1', to: 't2' },
    requires: {},
  }
  let t = host({ '.refs=t1&.limit=200': { rows: [edge] } })
  let p = mount(h(t.Door, { e: T1, view: 'Inspect.Full' }))
  try {
    assert(p.root.querySelector('a[href="/t2"]')?.textContent == 'N-t2')
    p.fire(
      p.root.querySelector('[aria-label="remove this requires edge"]')!,
      'click',
    )
    await tick()
    assertEquals(t.applied.at(-1), [{ entity: { eid: 'e1' }, $delete: true }])
    // linkedom selects no first option, as a browser does
    Object.defineProperty(p.root.querySelector('[name=relation]')!, 'value', {
      value: 'requires',
    })
    let to = p.root.querySelector<HTMLInputElement>('[name=to]')!
    to.value = 'T-2'
    p.fire(to.closest('form')!, 'submit')
    await tick()
    assertEquals(t.applied.at(-1), [{
      entity: { eid: '$edge' },
      edge: { from: 't1', to: 'T-2' },
      requires: {},
    }])
    // An end that names nothing is refused, and the section says why.
    to.value = 'T-404'
    p.fire(to.closest('form')!, 'submit')
    await tick()
    let links = p.root.querySelector('[data-section="Inspect.Links"] h2')!
    assert(links.textContent!.includes("no entity 'T-404'"))
  } finally {
    p.free()
  }
})

test('the map runs a line from its bar in its Query listing', async () => {
  let t = host({ '.task&.count': { count: 12 } })
  t.front.mutate(opened(t.front.ent, '.task&.count'))
  let p = mount(
    h(() => h(t.Door, { e: t.io.state(MAP)!, view: 'Inspect.Full' }), {}),
  )
  try {
    await tick()
    assert(p.root.querySelector('.Bar[data-id="inspect"]'))
    assert(t.asked.includes('.task&.count'), 'an aggregate is asked as typed')
    assert(p.root.textContent!.includes('12'))
    // A plain query is asked a window at a time, with its count beside it.
    t.front.mutate([{
      entity: { eid: 'inspect:query' },
      listing: { query: '.task' },
    }])
    await tick()
    assert(t.asked.includes('.task&.limit=50'))
    assert(t.asked.includes('.task&.count'))
  } finally {
    p.free()
  }
})

test('a terminal paints a page as values, with no controls to type in', () => {
  let t = host({}, false)
  let painted = print(h(t.Door, { e: T1, view: 'Inspect.Full' }), 80)
  for (let word of ['Fields', 'Fix the map', 'status', 'open', 'Feedback']) {
    assert(painted.includes(word), word)
  }
  assert(!painted.includes('leave feedback'))
})
