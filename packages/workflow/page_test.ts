// A workflow's page over a workflow the step runner ran (./testing.ts): a call
// per order, a shipment once it is answered, then a check filed to bea.
// Drawn through the inspector contract browse uses, in a browser document and
// in a terminal.
import { h, render } from 'preact'
import { parseHTML } from 'linkedom'
import { equal, lend, ok, test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { define, resolve } from '@yaks/render'
import type { Answer, Asks, Bundle, Io, View } from '@yaks/inspect'
import { print } from '@yaks/tui/print'
import { composition, sheet } from '@yaks/ui'
import type { Comp } from '@yaks/graph'
import { inspectViews } from './inspect.ts'
import { ask, fixture, ship, vocab } from './testing.ts'

let { g, apply, read, flow } = fixture()
let check = {
  eid: 'check',
  match: '$s .shipment, made.case=$k',
  write: [{
    entity: { eid: '$t' },
    task: {},
    doc: { title: 'Check the parcel' },
    filed: { assignee: 'bea' },
  }],
  when: 'write',
}
await flow('orders', ask, ship, check)
await apply([
  { entity: { eid: 'orders' }, doc: { body: 'Pack and ship' } },
  { entity: { eid: 'ask' }, doc: { title: 'Pack' } },
  { entity: { eid: 'ship' }, doc: { title: 'Ship' } },
])
let order = (eid: string) => apply([{ entity: { eid }, order: { item: eid } }])
let answer = async (o: string) => {
  let call = (await read('.call')).find((c) =>
    ((c.call as Comp).args as Comp).order == o
  )!
  await apply([{
    entity: { eid: `r-${o}` },
    result: { call: call.entity.eid },
  }])
}
for (let o of ['o1', 'o2', 'o3']) await order(o)
await answer('o1')
await answer('o3')
let [o3] = await read('.workflow_case.for=o3')
let [done] = await read(`.task&.made.case=${o3.entity.eid}`)
await apply([{
  entity: done.entity,
  completed: { at: '2026-11-27T00:00:00Z' },
}])
// An edit to the first step: the three calls it made read as outdated, and
// the next order's call does not.
await apply([{
  entity: { eid: 'ask' },
  step: {
    write: [{
      entity: { eid: '$c' },
      call: { name: 'wrap', args: { order: '$o' } },
    }],
  },
}])
await order('o4')

let asked = (line: string): Answer => ({
  rows: g.read(parse(line)) as Bundle[],
  ready: true,
})
let answers = (asks: Asks) =>
  Object.fromEntries(
    Object.entries(asks).map(([k, a]) => [
      k,
      a ? asked(typeof a == 'string' ? a : a.query) : { rows: [], ready: true },
    ]),
  )
let get = (eid: string) => (g.get([eid]) as Bundle[])[0]
let title = (b?: Bundle) => String((b?.doc as Comp | undefined)?.title ?? '')
// How any entity reads by name, and how a task and a call read as
// themselves: the page asks the registry, never which kind a row is.
let named = (match: string, said: (b: Bundle) => string): View => ({
  view: 'Inspect.Reference.Inline',
  match: parse(match),
  Render: ({ e }) => h('a', { 'data-ref': e.entity.eid }, said(e)),
})
let registry = define<View>([
  ...inspectViews,
  named('.task', (b) => `task “${title(b)}”`),
  named('.call', (b) => `call ${(b.call as Comp).name}`),
  named('.entity', (b) => title(b) || b.entity.eid),
])
let io: Io = {
  vocab,
  ask: answers,
  get,
  show: (e, view, ctx = {}) => {
    let r = resolve(registry, e, view, vocab)
    return r
      ? h(r.Render, { e, got: answers(r.asks?.(e, io, ctx) ?? {}), io, ctx })
      : null
  },
  can: (e, view) => !!resolve(registry, e, view, vocab),
  state: () => undefined,
  set: () => {},
  apply: () => {},
  edits: false,
  link: (id) => `/${id}`,
  find: (q) => `/?q=${q}`,
  go: () => {},
  id: (e) => e.entity.eid,
  kind: () => 'workflow',
  name: (id) => id,
  when: (at) => at,
}
let page = () => io.show(get('orders'), 'Workflow')

// Mounted in a browser document, where the page reads the journal once it
// knows its steps.
let { document } = parseHTML('<html><body><main></main></body></html>')
let root = document.querySelector('main')!
let back = lend('document', document)
render(h('div', {}, page()), root)
for (let i = 0; i < 6; i++) {
  await new Promise((go) => setTimeout(go, 0))
  render(h('div', {}, page()), root)
}
let html = root.cloneNode(true) as Element
render(null, root)
back()

let all = (q: string) => [...html.querySelectorAll(q)]
let stage = (i: number) =>
  all(`[data-stage="${i}"] [data-step]`).map((n) => n.getAttribute('data-step'))
let step = (eid: string) =>
  html.querySelector(`[data-step="${eid}"]`)?.textContent ?? ''
let kase = (item: string) =>
  all('[data-case]').find((n) =>
    n.querySelector('.Rows_Name [data-ref]')?.getAttribute('data-ref') == item
  )!
let where = (item: string) =>
  kase(item).querySelector('[data-where]')?.textContent

test('the map is the steps in stages, each after what feeds it', () => {
  equal([stage(0), stage(1), stage(2)], [['ask'], ['ship'], ['check']])
  ok(step('ask').includes('starts a case'))
  ok(step('ship').includes('after Pack'))
  // A step with no title is named by its match.
  ok(step('check').startsWith('$s .shipment, made.case=$kafter Ship'))
  ok(html.textContent?.includes('Pack and ship'))
})

test('each step counts the cases at it, made there and outdated', () => {
  ok(step('ask').includes('2 here · 4 made · 3 outdated'), step('ask'))
  ok(step('ship').endsWith('2 made'), step('ship'))
  ok(step('check').endsWith('1 here · 2 made'), step('check'))
})

test('a case says where it is and what holds it, the moving first', () => {
  equal(where('o1'), 'waiting on task “Check the parcel” for bea')
  equal(where('o2'), 'waiting on call pack')
  equal(where('o4'), 'waiting on call wrap')
  equal(where('o3'), 'done')
  equal(all('[data-case]').at(-1), kase('o3'))
})

test('what each step made for a case, each drawn as itself, the outdated marked', async () => {
  let made = (item: string) =>
    [...kase(item).querySelectorAll('[data-by]')].map((n) => [
      n.getAttribute('data-by'),
      n.textContent,
    ])
  let [shipped] = (await read('.shipment')).filter((b) =>
    (b.shipment as Comp).order == 'o1'
  )
  equal(made('o1'), [
    ['ask', 'call pack outdated'],
    ['ship', shipped.entity.eid],
    ['check', 'task “Check the parcel” for bea'],
  ])
  equal(made('o4'), [['ask', 'call wrap']])
  equal(all('[data-outdated]').length, 3)
})

test('a terminal prints the map and the cases', () => {
  let painted = print(page(), 100, sheet(composition))
    // deno-lint-ignore no-control-regex -- the painter's words, not its colors
    .replace(/\x1b\[[0-9;]*m/g, '')
  for (
    let said of [
      'Steps',
      'after Ship',
      'o1 waiting on task “Check the parcel” for bea',
      'Pack: call pack',
      'Cases 4',
    ]
  ) ok(painted.includes(said), said)
})
