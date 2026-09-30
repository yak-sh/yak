import { tick, until } from '@yaks/testing'
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { type ComponentChild, h, options, render } from 'preact'
import { loadVocab } from '@yaks/vocab'
import { bind, type Bundle, Edit, type Host, Prop } from './mod.ts'

let vocab = loadVocab([{
  $defs: {
    doc: {
      component: true,
      properties: {
        title: { type: 'string' },
        body: { type: 'string', store: 'blob' },
      },
    },
    task: {
      component: true,
      properties: {
        status: { type: 'string', enum: ['open', 'done'] },
        owner: { type: 'string', ref: 'entity', death: 'detach' },
        due: { type: 'string', format: 'date-time' },
        prio: { type: 'number', format: 'priority' },
        site: { type: 'string', format: 'uri' },
        urgent: { type: 'boolean' },
        domain: { type: 'string', well: 'domains' },
        line: { type: 'string', format: 'query' },
        data: { type: 'object' },
        seen: { type: 'string', stamped: true },
      },
    },
  },
}])

let T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
let P = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
let rows = (): Record<string, Bundle> => ({
  [T]: {
    entity: { eid: T, num: 1 },
    doc: { title: 'Fix the map', body: 'Stored body' },
    task: {
      status: 'open',
      owner: P,
      due: '2026-09-29T19:12:21.000Z',
      prio: 3,
      site: 'https://yak.sh/',
      urgent: true,
      data: { a: 1 },
      seen: 'yesterday',
    },
  },
  [P]: { entity: { eid: P, num: 2 }, doc: { title: 'Draw the map' } },
})

// A page: a document, a host over `rows` that keeps what it was sent and
// what it said, and a way to press and type.
let page = (more: Partial<Host> = {}) => {
  let { document, window } = parseHTML(
    '<html><body><main></main></body></html>',
  )
  let globals: Record<string, unknown> = {
    document,
    getSelection: () => ({ setPosition: () => {} }),
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    innerWidth: 1000,
    innerHeight: 800,
    Text: window.Text,
  }
  let prior = Object.keys(globals).map((k) =>
    [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const
  )
  for (let [k, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, k, { value, configurable: true })
  }
  // Effects run on the next turn, as a browser's next frame would.
  let raf = options.requestAnimationFrame
  options.requestAnimationFrame = (f) => setTimeout(f)
  let held = rows()
  let applied: Bundle[][] = []
  let said: string[] = []
  let asked: string[] = []
  let was = bind({
    vocab,
    get: (eid) => held[eid],
    apply: (change) => {
      applied.push(change)
      if (JSON.stringify(change).includes('T-404')) {
        return Promise.reject(new Error("no entity 'T-404'"))
      }
    },
    problem: (message) => void said.push(message),
    name: (eid) => String((held[eid]?.doc as { title?: string })?.title),
    id: (b) => `T-${b.entity.num}`,
    kind: () => 'task',
    when: (at) => `when ${at}`,
    find: (line) => (asked.push(line), Promise.resolve([held[P]])),
    values: (well) => well == 'domains' ? ['web', 'infra'] : [],
    ...more,
  })
  let root = document.querySelector('main')!
  let fire = async (el: Element, type: string, key?: string) => {
    let ev = new window.Event(type, { bubbles: true, cancelable: true })
    if (key) Object.defineProperty(ev, 'key', { value: key })
    el.dispatchEvent(ev)
    await tick()
  }
  let $ = <T extends Element = HTMLElement>(s: string) =>
    document.querySelector<T>(s)!
  return {
    root,
    held,
    applied,
    said,
    asked,
    fire,
    $,
    draw: (node: ComponentChild) => render(node, root),
    // Type over a value in place: its text, then the key that ends it.
    type: async (el: HTMLElement, text: string, end = 'Enter') => {
      el.textContent = text
      await fire(el, 'input')
      await fire(el, 'keydown', end)
    },
    [Symbol.dispose]: () => {
      render(null, root)
      bind(was)
      options.requestAnimationFrame = raf
      for (let [k, d] of prior) {
        if (d) Object.defineProperty(globalThis, k, d)
        else delete (globalThis as Record<string, unknown>)[k]
      }
    },
  }
}

let prop = (p: string, editable = true, comp = 'task') =>
  h(Prop, { eid: T, comp, prop: p, editable })

test("a value's face follows its type", () => {
  using p = page()
  let face = (name: string, comp = 'task') => {
    p.draw(prop(name, false, comp))
    return p.$('.Prop_Val')
  }
  assertEquals(face('title', 'doc').textContent, 'Fix the map')
  assertEquals(face('prio').textContent, 'P3')
  assertEquals(
    face('site').querySelector('a')?.getAttribute('href'),
    'https://yak.sh/',
  )
  assertEquals(face('due').textContent, 'when 2026-09-29T19:12:21.000Z')
  assert(face('due').querySelector('[data-tip]'))
  assertEquals(face('owner').textContent, 'Draw the map')
  assertEquals(face('domain').textContent, '—')
  assertEquals(p.root.querySelector('.Prop-live'), null)
})

test('a value is typed over where it stands, and written', async () => {
  using p = page()
  p.draw(prop('title', true, 'doc'))
  let val = p.$('.Prop_Val')
  await p.fire(val, 'click')
  await tick()
  let edit = p.$('.Prop .Edit')
  assert(edit.isContentEditable)
  assertEquals(edit.textContent, 'Fix the map')
  await p.type(edit, 'Fix the whole map')
  assertEquals(p.applied, [[{
    entity: { eid: T },
    doc: { title: 'Fix the whole map' },
  }]])
  assertEquals(p.said, [])
})

test('Escape puts a value back and writes nothing', async () => {
  using p = page()
  p.draw(h(Edit, { eid: T, comp: 'doc', prop: 'title' }))
  let edit = p.$('.Edit')
  await p.fire(edit, 'dblclick')
  assert(edit.isContentEditable)
  await p.type(edit, 'something else', 'Escape')
  assertEquals(edit.textContent, 'Fix the map')
  assertEquals(p.applied, [])
})

test('inline markdown shows at rest and its source is typed over', async () => {
  using p = page({ markup: (t) => t.replace(/`(.*)`/, '<code>$1</code>') })
  p.held[T].doc = { title: 'a `map`' }
  p.draw(h(Edit, { eid: T, comp: 'doc', prop: 'title', inline: true }))
  let edit = p.$('.Edit')
  assertEquals(edit.innerHTML, 'a <code>map</code>')
  await p.fire(edit, 'dblclick')
  assertEquals(edit.textContent, 'a `map`')
  // A second double-click while typing leaves the typing alone.
  edit.textContent = 'a `big` map'
  await p.fire(edit, 'dblclick')
  assertEquals(edit.textContent, 'a `big` map')
})

test('a refused write is said, and the stored value shows again', async () => {
  using p = page()
  p.draw(h(Edit, { eid: T, comp: 'doc', prop: 'title' }))
  let edit = p.$('.Edit')
  await p.fire(edit, 'dblclick')
  await p.type(edit, 'T-404')
  await tick()
  assertEquals(p.said, ["no entity 'T-404'"])
  assertEquals(edit.textContent, 'Fix the map')
  // Input that cannot be read is said without being sent.
  p.draw(prop('prio'))
  await p.fire(p.$('.Prop_Val'), 'click')
  await tick()
  await p.type(p.$('.Prop .Edit'), 'soon')
  assertEquals(p.applied.length, 1)
  assertEquals(p.said.length, 2)
})

test('a body held back is not offered until it lands, and asking lands it', async () => {
  let wanted: string[] = []
  using p = page({ want: (...at) => void wanted.push(at.join('.')) })
  delete (p.held[T].doc as Record<string, unknown>).body
  p.draw(h(Edit, { eid: T, comp: 'doc', prop: 'body', multi: true }))
  await tick()
  let edit = p.$('.Edit')
  await p.fire(edit, 'dblclick')
  assertEquals(edit.isContentEditable, false)
  assertEquals(wanted, [`${T}.doc.body`])
})

test('a value made read-only while typed over reverts and writes nothing', async () => {
  using p = page()
  let at = { eid: T, comp: 'doc', prop: 'body', multi: true }
  p.draw(h(Edit, at))
  let edit = p.$('.Edit')
  await p.fire(edit, 'dblclick')
  edit.textContent = 'unsaved words'
  p.draw(h(Edit, { ...at, readOnly: true }))
  await p.fire(edit, 'blur')
  assertEquals(edit.textContent, 'Stored body')
  assertEquals(p.applied, [])
})

test("a closed set's choices float beside the value, the held one marked", async () => {
  using p = page({ wears: (_c, _p, v) => h('i', { class: 'Dot' }, v[0]) })
  p.draw(prop('status'))
  await p.fire(p.$('.Prop_Val'), 'click')
  assertEquals(p.$('.Prop_Val').textContent, 'open') // the face stays
  let tabs = [...p.root.ownerDocument.querySelectorAll('.Overlay .Prop_Tab')]
  assertEquals(tabs.map((t) => t.textContent), ['oopen', 'ddone'])
  assert(tabs[0].className.includes('Prop_Tab-on'))
  await p.fire(tabs[1], 'click')
  assertEquals(p.applied, [[{ entity: { eid: T }, task: { status: 'done' } }]])
  assertEquals(p.root.ownerDocument.querySelector('.Overlay'), null)
})

test('a flag is its own toggle', async () => {
  using p = page()
  p.draw(prop('urgent'))
  await p.fire(p.$('.Prop_Val'), 'click')
  assertEquals(p.applied, [[{ entity: { eid: T }, task: { urgent: false } }]])
})

test("a reference is picked from the graph's answer, or cleared", async () => {
  using p = page()
  p.draw(prop('owner'))
  await p.fire(p.$('.Prop_Val'), 'click')
  let find = p.$<HTMLInputElement>('.Overlay .Prop_Find')
  find.value = 'draw'
  await p.fire(find, 'input')
  let row = await until(() => p.$('.Overlay .Prop_Row:not(.Prop_Row-none)'))
  assertEquals(p.asked.length, 1)
  assert(p.asked[0].includes('draw'))
  assertEquals(row.textContent, 'T-2 — Draw the map')
  await p.fire(row, 'click')
  await p.fire(p.$('.Prop_Val'), 'click')
  await p.fire(p.$('.Overlay .Prop_Row-none'), 'click')
  assertEquals(p.applied.map((c) => c[0].task), [{ owner: P }, {
    owner: null,
  }])
})

test('a well offers the values seen so far, and what is typed', async () => {
  using p = page()
  p.draw(prop('domain'))
  await p.fire(p.$('.Prop_Val'), 'click')
  let rows = () =>
    [...p.root.ownerDocument.querySelectorAll('.Overlay .Prop_Row')]
      .map((r) => r.textContent)
  assertEquals(rows(), ['none', 'web', 'infra'])
  let find = p.$<HTMLInputElement>('.Overlay .Prop_Find')
  find.value = 'ops'
  await p.fire(find, 'input')
  assertEquals(rows(), ['none', '“ops”'])
  await p.fire(find, 'keydown', 'Enter')
  assertEquals(p.applied, [[{ entity: { eid: T }, task: { domain: 'ops' } }]])
})

test("a number is typed over in place, in the host's language", async () => {
  using p = page({ editing: { parse: (v) => Number(String(v).slice(1)) } })
  p.draw(prop('prio'))
  await p.fire(p.$('.Prop_Val'), 'click')
  await tick()
  let edit = p.$('.Prop .Edit')
  assert(edit.isContentEditable)
  assertEquals(edit.textContent, '3')
  await p.type(edit, 'P2')
  assertEquals(p.applied, [[{ entity: { eid: T }, task: { prio: 2 } }]])
})

test("a query is typed in the host's query field, or as text", async () => {
  using p = page()
  p.draw(prop('line'))
  await p.fire(p.$('.Prop_Val'), 'click')
  await tick()
  assert(p.$('.Prop .Edit').isContentEditable)
  using q = page({
    fields: {
      Filter: ({ id }) => h('input', { class: 'Field', 'data-id': id }),
      set: () => {},
    },
  })
  q.draw(prop('line'))
  await q.fire(q.$('.Prop_Val'), 'click')
  assertEquals(q.$('.Prop_Query .Field').dataset.id, `query:${T}:task.line`)
})

test('a JSON value is typed over as its JSON text', async () => {
  using p = page()
  p.draw(prop('data'))
  await p.fire(p.$('.Prop_Val'), 'click')
  let edit = p.$('.Prop .Edit')
  assertEquals(edit.textContent, '{"a":1}')
  await p.type(edit, '{"a":2}')
  assertEquals(p.applied, [[{ entity: { eid: T }, task: { data: { a: 2 } } }]])
})

test('a value the vocabulary keeps from clients is never offered', async () => {
  using p = page()
  p.draw(prop('seen'))
  assertEquals(p.root.querySelector('.Prop-live'), null)
  await p.fire(p.$('.Prop_Val'), 'click')
  assertEquals(p.root.querySelector('.Edit, .Overlay'), null)
})

test("a page's own registry draws the editors it selects", () => {
  using p = page({
    renderView: (_eid, view, ctx) => h('em', null, `${view} ${ctx.prop}`),
  })
  p.draw(h(Edit, { eid: T, comp: 'doc', prop: 'title' }))
  assertEquals(p.root.innerHTML, '<em>Inline.Edit title</em>')
})
