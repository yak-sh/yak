// The lists a person's machine offers, read through their space's tunnel and
// drawn in their Updates and beside their conversation with their Operator:
// both ends in one process.
import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import { type Comp, mint } from '@yaks/graph'
import { parseHTML } from 'linkedom'
import { Fragment, h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { mcpConnect } from './connected-mcp.ts'
import { machineOf } from './machine-testing.ts'
import {
  answered,
  type Listed,
  listOf,
  listsOf,
  waitsOf,
} from './operator-lists.ts'
import { operatorContext } from './operator.ts'
import { chatPage, operatorAnswer, updatesPage } from './operator-page.ts'
import {
  operatorMemory,
  operatorModel,
  operatorService,
} from './operator-testing.ts'
import { waitingOn } from './operator-relay.ts'

let { box, env, dir, space, ada, bob, person } = await machineOf(
  'operator-lists',
  ['task_list', 'decision_answer'],
)
let decision = mint()
let numbered = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    entity: { eid: mint() },
    task: {},
    doc: { title: `Ask ${String(i).padStart(2, '0')}`, body: '1. Do it.' },
  }))
await box.graph.apply([
  {
    entity: { eid: decision },
    task: {},
    doc: { title: 'Which day?' },
    decision: {
      question: 'Which day does it ship?',
      choices: [
        { label: 'Friday', description: 'This week.' },
        { label: 'Monday', description: 'After the weekend.' },
      ],
      recommended: 'Monday',
    },
  },
  ...numbered(12),
], { trusted: true })

let connect = async (lists?: unknown, more: Record<string, unknown> = {}) =>
  await mcpConnect.run(
    await operatorContext(env, { person: ada }, space, () => dir),
    {
      name: 'box',
      url: '/mcp',
      machine: 'adas',
      ...lists ? { lists } : {},
      ...more,
    },
  )
let open = { query: '.task.status=open&.order=doc.title' }
let needs = {
  title: 'What needs you',
  tool: 'task_list',
  args: open,
  waits: true,
}
let listed = async (e = env, at = space.eid) =>
  (await listsOf(e, ada, at)).lists
let one = async () => (await listed())[0]

// The list drawn, as the person reads it: each row's lines and buttons, and
// how many of them the bell counts.
let drawn = (listed: Listed) => {
  let { document } = parseHTML(
    `<div>${
      renderToString(h(Fragment, null, listOf(listed, '/a', '/manage/here')))
    }</div>`,
  )
  return {
    count: waitsOf([listed]),
    back: document.querySelector('[name=back]')?.getAttribute('value'),
    rows: [...document.querySelectorAll('.Asks_Item')].map((r) =>
      [...r.querySelectorAll('.Rows_Name, .Rows_Meta, button')].map((e) =>
        e.textContent
      )
    ),
    title: document.querySelector('.Card_Title')?.textContent,
    badge: document.querySelector('.Card_Head .Badge')?.textContent,
    ids: [...document.querySelectorAll('.Asks_Item')].map((r) => r.id),
    // Each "Other": the row it answers, and whether it has a box for words.
    others: [...document.querySelectorAll('.Asks_Other')].map((o) => [
      o.querySelector('[name=ask]')?.getAttribute('value'),
      !!o.querySelector('textarea[name=choice][required]'),
    ]),
    text: document.querySelector('div')!.textContent ?? '',
  }
}

test('a person who set no list is shown none', async () => {
  await connect()
  assertEquals(await listed(), [])
})

test('the list is what the server answers, in its order, the first ten shown and the rest behind one line', async () => {
  await connect([needs])
  let list = await one()
  assertEquals(list.off, undefined)
  assertEquals(list.asks.map((a) => a.title), [
    ...Array.from(
      { length: 12 },
      (_, i) => `Ask ${String(i).padStart(2, '0')}`,
    ),
    'Which day?',
  ])
  let { rows, ids, text, count, back, title, badge, others } = drawn(list)
  assertEquals([title, badge], ['What needs you', '13'])
  assertEquals(rows[0], ['Ask 00', 'Do it.', 'Reply'])
  assertEquals([rows.length, count], [13, 13])
  // A choice comes back to the page it was pressed on.
  assertEquals(back, '/manage/here')
  // An alert about one opens the page at its row (operator-alerts.ts).
  assertEquals(ids.at(-1), `ask-${decision}`)
  assertEquals(text.includes('3 more'), true)
  assertEquals(rows.at(-1), [
    'Which day?',
    'Which day does it ship?',
    'Monday',
    'Friday',
    'Answer',
    'Reply',
  ])
  // Only a decision offers "Other", a box for an answer of their own.
  assertEquals(others, [[decision, true]])
})

test('a choice pressed beside a decision is the person’s own answer on their machine', async () => {
  let { server } = await one()
  await answered(env, ada, space.eid, server, decision, 'Friday')
  let [it] = await box.graph.get([decision], ['decided'])
  let { choice, by, via } = it.decided as Comp
  assertEquals([choice, by, via], ['Friday', person, box.me])
})

test('their own words under “Other” are their answer on their machine, and a decision there rides beside their words to the Operator', async () => {
  let own = mint()
  await box.graph.apply([{
    entity: { eid: own },
    task: {},
    doc: { title: 'Which colour?' },
    decision: {
      question: 'Which colour is the cover?',
      choices: [
        { label: 'Red', description: 'Warm.' },
        { label: 'Grey', description: 'Calm.' },
      ],
      recommended: 'Grey',
    },
  }], { trusted: true })
  let list = await one()
  assertEquals(
    (await waitingOn(operatorMemory(), ada, [list])).includes(
      `- ${own}: Which colour is the cover? "Grey", "Red"`,
    ),
    true,
  )
  await answered(env, ada, space.eid, list.server, own, 'Blue, like the sea')
  let [it] = await box.graph.get([own], ['decided'])
  let { choice, by } = it.decided as Comp
  assertEquals([choice, by], ['Blue, like the sea', person])
})

test('a person who does not own the machine’s space reaches nothing, and a machine that is off is said to be', async () => {
  let { server } = await one()
  await assertRejects(() =>
    answered(env, bob, space.eid, server, decision, 'Monday')
  )
  let off = { ...env, DISPATCH: undefined } as typeof env
  let [gone] = await listed(off)
  assertEquals(gone.asks, [])
  assertEquals(typeof gone.off, 'string')
  let shown = drawn(gone)
  assertEquals(
    shown.text.includes('Your machine is off, so What needs you can’t'),
    true,
  )
  assertEquals(shown.count, 0)
})

test('where an id the server names opens is the server’s to say, and an empty one says none', async () => {
  let opened = async (mentions: string) => {
    await connect(undefined, { mentions })
    return (await listsOf(env, ada, space.eid)).mentions
  }
  assertEquals(
    await opened('https://box.example/{id}'),
    'https://box.example/{id}',
  )
  assertEquals(await opened(''), undefined)
})

test('another space’s Operator page lists nothing of the machine', async () => {
  assertEquals(await listed(env, mint()), [])
})

test('lists are read in their order, and only those that wait are counted, where an alert can open', async () => {
  let wip = { query: '.task.status=open&.order=-doc.title&.limit=2' }
  await connect([needs, { title: 'Working now', tool: 'task_list', args: wip }])
  let [first, second] = await listed()
  assertEquals([first.title, first.waits, second.title, second.waits], [
    'What needs you',
    true,
    'Working now',
    false,
  ])
  assertEquals(second.asks.map((a) => a.title), ['Ask 11', 'Ask 10'])
  let shown = drawn(second)
  assertEquals([shown.count, shown.ids, shown.badge], [0, ['', ''], undefined])
  // Set again, they are the new ones and no others.
  await connect([{ ...needs, title: 'Asks' }])
  assertEquals((await listed()).map((l) => l.title), [
    'Asks',
  ])
})

test('an answer of words alone is drawn as its lines', () => {
  let shown = drawn({
    server: 's',
    title: 'Spend',
    waits: false,
    asks: [],
    lines: ['claude week: 17% used', 'codex week: 74% used'],
  })
  assertEquals([shown.title, shown.count], ['Spend', 0])
  assertEquals(shown.text, 'Spendclaude week: 17% usedcodex week: 74% used')
})

test('a list without a title or tool is refused, and [] takes them away', async () => {
  await assertRejects(() => connect([{ tool: 'task_list' }]))
  await connect([])
  assertEquals(await listed(), [])
})

test('a server’s lists are read on one connection, each call sent without listing its tools first', async () => {
  await connect([needs, { ...needs, title: 'Again', waits: false }])
  let asked: string[] = []
  let at = env.DISPATCH!
  let seen = {
    ...env,
    DISPATCH: {
      ...at,
      get: (...a: Parameters<typeof at.get>) => ({
        fetch: async (r: Request) => {
          if (r.method == 'POST') asked.push((await r.clone().json()).method)
          return at.get(...a).fetch(r)
        },
      }),
    },
  } as typeof env
  let [first, again] = await listed(seen)
  assertEquals([first.off, again.off], [undefined, undefined])
  assertEquals(again.asks, first.asks)
  let count = (method: string) => asked.filter((m) => m == method).length
  assertEquals(
    [count('initialize'), count('tools/list'), count('tools/call')],
    [1, 0, 2],
  )
})

test('pages draw without lists their machine has not answered, saying nothing while they are read, and they fill in after', async () => {
  await connect([needs])
  let held = { person: ada, role: 'owner' as const, space: space.eid }
  let { binding } = operatorService(
    env,
    held,
    operatorModel(() => Promise.reject(new Error('no turn here'))),
  )
  let open!: () => void
  let gate = new Promise<void>((go) => open = go)
  let at = env.DISPATCH!
  let slow = {
    ...env,
    BUILDER: binding,
    DISPATCH: {
      ...at,
      get: (...a: Parameters<typeof at.get>) => ({
        fetch: async (r: Request) => (await gate, at.get(...a).fetch(r)),
      }),
    },
  } as typeof env
  let page = async (drawing: Promise<Response>) => {
    let text = await (await drawing).text()
    return {
      document: parseHTML(text).document,
      from: text.match(/fetch\("([^"]+lists=1[^"]*)"\)/)?.[1],
    }
  }
  // In the aside the lists stand hidden around their slot.
  let chat = (await page(chatPage(slow, space, held, 'new'))).document
  let lists = chat.querySelector('#aside .Talk_Lists')!
  assertEquals(lists.querySelector('[data-later=other]')?.textContent, '')
  assert(lists.hasAttribute('hidden'))
  // What waits on the person comes into their Updates.
  let { document, from } = await page(updatesPage(slow, space, held))
  let slot = document.querySelector('.Updates [data-later=waits]')!
  assertEquals(slot.textContent, '')
  assertEquals(document.querySelector('.Asks_Item'), null)
  open()
  let got = await (await operatorAnswer(
    new Request(`https://yaks.app${from}`),
    slow,
    space,
    held,
  ))!.json()
  let asks = (await one()).asks.length
  let rows = parseHTML(`<div>${got.waits}</div>`).document
  assertEquals(rows.querySelectorAll('.Asks_Item').length, asks)
  assertEquals([got.waiting, got.other], [asks, ''])
  // a choice there comes back to the Updates
  assertEquals(
    new URL(from!, 'https://yaks.app').searchParams.get('back'),
    `/manage/${space.slug}/updates`,
  )
})
