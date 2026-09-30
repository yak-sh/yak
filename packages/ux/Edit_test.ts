import { tick, until } from '@yaks/testing'
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { type ComponentChild, h, options, render } from 'preact'
import { client } from '@yaks/client'
import { desk, draftDoc, drafts } from '@yaks/draft'
import { mint } from '@yaks/graph'
import { Float } from '@yaks/ui'
import { loadVocab } from '@yaks/vocab'
import { at, type Bundle, Edit, type Host, place, Ux } from './mod.ts'
import { docs } from './vocab.ts'

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
let task = (): Bundle => ({
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
})
let person: Bundle = {
  entity: { eid: P, num: 2 },
  doc: { title: 'Draw the map' },
}

// A page: a document, a page graph, and a host whose `write` keeps what was
// emitted; a way to press and type.
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
    addEventListener: () => {},
    removeEventListener: () => {},
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
  let front = client(loadVocab(docs), [], { vault: false, wireVault: false })
  // The person's drafts, in a graph of their own.
  let by = mint()
  let typed = desk(
    client(loadVocab([draftDoc]), [drafts()], { vault: false }),
    { by: () => by },
  )
  let emitted: Bundle[] = []
  let asked: string[] = []
  let host: Host = {
    vocab,
    front,
    drafts: typed,
    write: (b) => void emitted.push(b),
    name: (eid) => eid == P ? 'Draw the map' : eid,
    id: (b) => `T-${b.entity.num}`,
    kind: () => 'task',
    when: (at) => `when ${at}`,
    find: (line) => (asked.push(line), Promise.resolve([person])),
    values: (well) => well == 'domains' ? ['web', 'infra'] : [],
    Float,
    ...more,
  }
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
    front,
    drafts: typed,
    emitted,
    asked,
    fire,
    $,
    draw: (node: ComponentChild) => render(h(Ux, { host }, node), root),
    // Take the tree off the page as a browser does, blurring what is typed in
    // as it goes.
    drop: () => {
      root.querySelector('[contenteditable]')
        ?.dispatchEvent(new window.Event('blur'))
      render(null, root)
    },
    // Type over a value in place: its text, then the key that ends it.
    type: async (el: HTMLElement, text: string, end = 'Enter') => {
      el.textContent = text
      await fire(el, 'input')
      await fire(el, 'keydown', end)
    },
    [Symbol.dispose]: () => {
      render(null, root)
      front.close()
      typed.close()
      options.requestAnimationFrame = raf
      for (let [k, d] of prior) {
        if (d) Object.defineProperty(globalThis, k, d)
        else delete (globalThis as Record<string, unknown>)[k]
      }
    },
  }
}

let value = (p: string, editable = true, comp = 'task', e = task()) =>
  h(Edit, { e, comp, prop: p, editable })

// Press a value open and settle.
let press = async (p: ReturnType<typeof page>) => {
  await p.fire(p.$('.Prop_Val'), 'click')
  await tick()
}

test("a value's face follows its type", () => {
  using p = page()
  let face = (name: string, comp = 'task') => {
    p.draw(value(name, false, comp))
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

test('a value typed over where it stands emits the bundle it was handed, changed', async () => {
  using p = page()
  p.draw(value('title', true, 'doc'))
  await press(p)
  let edit = p.$('.Prop .Edit')
  assert(edit.isContentEditable)
  assertEquals(edit.textContent, 'Fix the map')
  await p.type(edit, 'Fix the whole map')
  assertEquals(p.emitted, [{
    entity: { eid: T },
    doc: { title: 'Fix the whole map' },
  }])
  assertEquals(p.root.querySelector('.Edit'), null) // closed again
})

test("a caller's onChange takes what it emits, and nothing reaches the host", async () => {
  using p = page()
  let mine: Bundle[] = []
  p.draw(
    h(Edit, {
      e: task(),
      comp: 'task',
      prop: 'urgent',
      editable: true,
      onChange: (b) => void mine.push(b),
    }),
  )
  await press(p)
  assertEquals(mine, [{ entity: { eid: T }, task: { urgent: false } }])
  assertEquals(p.emitted, [])
})

test('Escape puts a value back and emits nothing', async () => {
  using p = page()
  p.draw(h(Edit.Text, { e: task(), comp: 'doc', prop: 'title' }))
  await p.fire(p.$('.Edit'), 'dblclick')
  let edit = p.$('.Edit')
  assert(edit.isContentEditable)
  await p.type(edit, 'something else', 'Escape')
  assertEquals(p.$('.Edit').textContent, 'Fix the map')
  assertEquals(p.emitted, [])
})

test('inline markdown shows at rest and its source is typed over', async () => {
  using p = page({ markup: (t) => t.replace(/`(.*)`/, '<code>$1</code>') })
  let e = { ...task(), doc: { title: 'a `map`' } }
  p.draw(h(Edit.Text, { e, comp: 'doc', prop: 'title', inline: true }))
  assertEquals(p.$('.Edit').innerHTML, 'a <code>map</code>')
  await p.fire(p.$('.Edit'), 'dblclick')
  let edit = p.$('.Edit')
  assertEquals(edit.textContent, 'a `map`')
  // A second double-click while typing leaves the typing alone.
  edit.textContent = 'a `big` map'
  await p.fire(edit, 'dblclick')
  assertEquals(p.$('.Edit').textContent, 'a `big` map')
})

test('input that cannot be read is emitted as a Refused event, and no value', async () => {
  using p = page()
  p.draw(value('prio'))
  await press(p)
  await p.type(p.$('.Prop .Edit'), 'soon')
  assertEquals(p.emitted.length, 1)
  assertEquals(Object.keys(p.emitted[0]), ['entity', 'Refused'])
  assert(
    String((p.emitted[0].Refused as { said: string }).said).includes('prio'),
  )
})

test('what is typed is the draft, and a remount types on from it', async () => {
  using p = page()
  let title = h(Edit.Text, { e: task(), comp: 'doc', prop: 'title' })
  let draft = place(T, 'doc', 'title')
  p.draw(title)
  await p.fire(p.$('.Edit'), 'dblclick')
  let edit = p.$('.Edit')
  edit.textContent = 'Fix the ma'
  await p.fire(edit, 'input')
  assertEquals(p.drafts.text(draft), 'Fix the ma')
  p.drop() // unmounted mid-typing: nothing emitted, the draft kept
  await tick()
  assertEquals(p.emitted, [])
  p.draw(title)
  await tick()
  assert(p.$('.Edit').isContentEditable)
  assertEquals(p.$('.Edit').textContent, 'Fix the ma')
  await p.type(p.$('.Edit'), 'Fix the map now')
  assertEquals(p.emitted, [{
    entity: { eid: T },
    doc: { title: 'Fix the map now' },
  }])
  assertEquals(p.drafts.text(draft), '', 'sending it spent it')
  assertEquals(p.front.ent(at('', T, 'doc', 'title'))?.Edit, undefined)
})

test('a draft shows open wherever its value is drawn, and Escape puts it back', async () => {
  using p = page()
  let title = (view: string) =>
    h(Ux, { at: view }, h(Edit.Text, { e: task(), comp: 'doc', prop: 'title' }))
  p.draw(h('div', null, title('bar'), title('body')))
  let edits = () => [...p.root.querySelectorAll<HTMLElement>('.Edit')]
  await p.fire(edits()[1], 'dblclick')
  edits()[1].textContent = 'Fix the moon'
  await p.fire(edits()[1], 'input')
  assertEquals(
    edits().map((e) => [e.isContentEditable, e.textContent]),
    [[true, 'Fix the moon'], [true, 'Fix the moon']],
  )
  await p.fire(edits()[1], 'keydown', 'Escape')
  await tick()
  assertEquals(edits().map((e) => e.isContentEditable), [false, false])
  assertEquals([p.emitted, p.drafts.text(place(T, 'doc', 'title'))], [[], ''])
})

test('the same value drawn in each view of each card keeps a state of its own', async () => {
  using p = page()
  let title = (view: string) =>
    h(Ux, { at: view }, h(Edit.Text, { e: task(), comp: 'doc', prop: 'title' }))
  let card = (eid: string) => h(Ux, { at: eid }, title('bar'), title('body'))
  p.draw(h('div', null, card('c1'), card('c2')))
  let edits = () => [...p.root.querySelectorAll<HTMLElement>('.Edit')]
  await p.fire(edits()[3], 'dblclick')
  assertEquals(edits().map((e) => e.isContentEditable), [
    false,
    false,
    false,
    true,
  ])
})

test('a body the bundle does not carry is not offered', async () => {
  using p = page()
  let e = { ...task(), doc: { title: 'Fix the map' } }
  p.draw(h(Edit.Text, { e, comp: 'doc', prop: 'body', multi: true }))
  await p.fire(p.$('.Edit'), 'dblclick')
  assertEquals(p.$('.Edit').isContentEditable, false)
})

test('a value made read-only while typed over closes and emits nothing', async () => {
  using p = page()
  let at = { e: task(), comp: 'doc', prop: 'body', multi: true }
  p.draw(h(Edit.Text, at))
  await p.fire(p.$('.Edit'), 'dblclick')
  p.$('.Edit').textContent = 'unsaved words'
  p.draw(h(Edit.Text, { ...at, readOnly: true }))
  await tick()
  assertEquals(p.$('.Edit').textContent, 'Stored body')
  assertEquals(p.$('.Edit').isContentEditable, false)
  assertEquals(p.emitted, [])
})

test("a closed set's choices float beside the value, the held one marked", async () => {
  using p = page({ wears: (_c, _p, v) => h('i', { class: 'Dot' }, v[0]) })
  p.draw(value('status'))
  await press(p)
  assertEquals(p.$('.Prop_Val').textContent, 'open') // the face stays
  let tabs = [...p.root.ownerDocument.querySelectorAll('.Overlay .Prop_Tab')]
  assertEquals(tabs.map((t) => t.textContent), ['oopen', 'ddone'])
  assert(tabs[0].className.includes('Prop_Tab-on'))
  await p.fire(tabs[1], 'click')
  assertEquals(p.emitted, [{ entity: { eid: T }, task: { status: 'done' } }])
  assertEquals(p.root.ownerDocument.querySelector('.Overlay'), null)
})

test('the control alone opens where its owner says, and closes on a choice', async () => {
  using p = page()
  let anchor = { current: null }
  let mine: Bundle[] = []
  p.draw(
    h(Edit.Control, {
      e: task(),
      comp: 'task',
      prop: 'status',
      anchor,
      onChange: (b) => void mine.push(b),
    }),
  )
  assertEquals(p.root.ownerDocument.querySelector('.Overlay'), null)
  p.front.mutate([{
    entity: { eid: at('', T, 'task', 'status') },
    Edit: { open: true },
  }])
  await tick()
  let tabs = [...p.root.ownerDocument.querySelectorAll('.Overlay .Prop_Tab')]
  await p.fire(tabs[1], 'click')
  assertEquals(mine, [{ entity: { eid: T }, task: { status: 'done' } }])
  assertEquals(p.root.ownerDocument.querySelector('.Overlay'), null)
})

test('a flag is its own toggle', async () => {
  using p = page()
  p.draw(value('urgent'))
  await press(p)
  assertEquals(p.emitted, [{ entity: { eid: T }, task: { urgent: false } }])
})

test("a reference is picked from the graph's answer, or cleared", async () => {
  using p = page()
  p.draw(value('owner'))
  await press(p)
  let find = p.$<HTMLInputElement>('.Overlay .Prop_Find')
  find.value = 'draw'
  await p.fire(find, 'input')
  let row = await until(() => p.$('.Overlay .Prop_Row:not(.Prop_Row-none)'))
  assertEquals(p.asked.length, 1)
  assert(p.asked[0].includes('draw'))
  assertEquals(row.textContent, 'T-2 — Draw the map')
  await p.fire(row, 'click')
  await press(p)
  await p.fire(p.$('.Overlay .Prop_Row-none'), 'click')
  assertEquals(p.emitted.map((b) => b.task), [{ owner: P }, { owner: null }])
})

test('a well offers the values seen so far, and what is typed', async () => {
  using p = page()
  p.draw(value('domain'))
  await press(p)
  let rows = () =>
    [...p.root.ownerDocument.querySelectorAll('.Overlay .Prop_Row')]
      .map((r) => r.textContent)
  assertEquals(rows(), ['none', 'web', 'infra'])
  let find = p.$<HTMLInputElement>('.Overlay .Prop_Find')
  find.value = 'ops'
  await p.fire(find, 'input')
  assertEquals(rows(), ['none', '“ops”'])
  await p.fire(p.$('.Overlay .Prop_Find'), 'keydown', 'Enter')
  assertEquals(p.emitted, [{ entity: { eid: T }, task: { domain: 'ops' } }])
})

test("a number is typed over in place, in the host's language", async () => {
  using p = page({ editing: { parse: (v) => Number(String(v).slice(1)) } })
  p.draw(value('prio'))
  await press(p)
  let edit = p.$('.Prop .Edit')
  assert(edit.isContentEditable)
  assertEquals(edit.textContent, '3')
  await p.type(edit, 'P2')
  assertEquals(p.emitted, [{ entity: { eid: T }, task: { prio: 2 } }])
})

test("a query is typed in the host's query field, or as text", async () => {
  using p = page()
  p.draw(value('line'))
  await press(p)
  assert(p.$('.Prop .Edit').isContentEditable)
  using q = page({
    fields: {
      Filter: ({ id }) => h('input', { class: 'Field', 'data-id': id }),
    },
  })
  q.draw(value('line'))
  await press(q)
  assertEquals(q.$('.Prop_Query .Field').dataset.id, place(T, 'task', 'line'))
})

test('a JSON value is typed over as its JSON text', async () => {
  using p = page()
  p.draw(value('data'))
  await press(p)
  let edit = p.$('.Prop .Edit')
  assertEquals(edit.textContent, '{"a":1}')
  await p.type(edit, '{"a":2}')
  assertEquals(p.emitted, [{ entity: { eid: T }, task: { data: { a: 2 } } }])
})

test('a value the vocabulary keeps from clients is never offered', async () => {
  using p = page()
  p.draw(value('seen'))
  assertEquals(p.root.querySelector('.Prop-live'), null)
  await press(p)
  assertEquals(p.root.querySelector('.Edit, .Overlay'), null)
})
