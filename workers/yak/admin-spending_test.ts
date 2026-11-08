// The admin's Spending page (admin.ts `spendingPage`, admin-spending.ts):
// each day's dollars by source and by who covered them, as the directory's
// spend rule keeps them, and each conversation and piece of a request as the
// space's Operator recorded them; for the admin alone.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { answer } from './admin.ts'
import { directoryOf, META } from './directory.ts'
import { platform } from './testing.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { rootOf } from './operator-root.ts'
import { COOKIE, sign } from './lib/token.ts'
import { monthOf } from './meter.ts'

let p = platform('admin-spending', { SESSION_SECRET: 'secret' })
let dir = directoryOf(p.env.STORE)
let [jeff, root, eid] = [0, 0, 0].map(() => crypto.randomUUID())
let as = (person: string) => ({ 'x-yak-person': person, 'x-yak-role': 'owner' })
let kernel = { ...as(root), 'x-yak-kernel': '1' }
await dir.apply({
  entities: [
    {
      entity: { eid: jeff },
      person: {},
      doc: { title: 'Jeff' },
      email: { address: 'jeff@example.com' },
    },
    { entity: { eid: root }, person: {}, doc: { title: 'Root' } },
    { entity: { eid }, space: { slug: 'clerk', store: 'clerk' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person: jeff, space: eid, role: 'owner' },
    },
  ],
}, as(jeff))
await dir.apply({
  entities: [{
    entity: { eid: crypto.randomUUID() },
    member: {
      person: root,
      space: (await dir.space(META.space))!.eid,
      role: 'owner',
    },
  }],
}, kernel)

// What the space spent, as every paid call adds it (model-spend.ts): the
// Operator's model and a call's voice, on a free space the platform covers.
let month = monthOf(new Date())
for (let spend of [{ models: 0.5, source: 'anthropic' }, { realtime: 0.25 }]) {
  await dir.apply({
    entities: [{ entity: { eid }, spend: { month, ...spend } }],
  }, kernel)
}

let service = operatorService(
  p.env,
  { person: root, role: 'owner', space: eid, administrative: true },
  operatorModel(() =>
    Promise.resolve({
      id: crypto.randomUUID(),
      model: 'test-model',
      items: [{ kind: 'assistant', text: 'Posted.' }],
      cost: 0.0005,
    })
  ),
)
p.env.BUILDER = service.binding
await receive(
  service.store,
  { space: eid, person: jeff, channel: 'chat' },
  'Post the meeting.',
)
await service.drain()

let cookies = Object.fromEntries(
  await Promise.all([jeff, root].map(async (person) => [
    person,
    `${COOKIE}=${await sign({ person, space: null, exp: 4e9 }, 'secret')}`,
  ])),
)
let get = async (path: string, person = root) => {
  let out = (await answer(
    new Request(`https://yaks.app${path}`, {
      headers: { cookie: cookies[person] },
    }),
    p.env,
    path,
    dir,
  ))!
  return { status: out.status, document: parseHTML(await out.text()).document }
}
let texts = (d: ParentNode, s: string) =>
  [...d.querySelectorAll(s)].map((e) => e.textContent?.trim())
// Each table's rows, a row its cells' words.
let tables = (d: ParentNode) =>
  [...d.querySelectorAll('.Table')].map((t) =>
    [...t.querySelectorAll('.Table_Row')].map((r) =>
      texts(r, '.Table_Heading, .Table_Cell')
    )
  )

let page = await get('/admin/spending')
let [sources, operator, spaces, top, runs, fixed] = tables(page.document)

test('the spending page says what each day spent, by source and by who covered it', () => {
  assertEquals(page.status, 200)
  let facts = Object.fromEntries(
    [...page.document.querySelectorAll('.Directory_Facts > div')].map((
      f,
    ) => [
      f.querySelector('dt')!.textContent,
      f.querySelector('dd')!.textContent,
    ]),
  )
  assertEquals(facts['Spent in 30 days'], '$0.75')
  assertEquals(facts['Given by the platform'], '$0.75 (100%)')
  // The Operator's own request, held and settled through the directory,
  // under the provider it asked.
  assertEquals(sources.slice(1).map((r) => r.slice(0, 4)), [
    ['Anthropic', '$0.50', '$0.50', '$0.50'],
    ['Voice', '$0.25', '$0.25', '$0.25'],
    ['Workers AI', '$0.0005', '$0.0005', '$0.0005'],
  ])
  assertEquals(operator.slice(1).map((r) => r.slice(0, 2)), [
    ['Workers AI', '$0.0005'],
  ])
})

test('the top spaces and conversations each open on their page', () => {
  assertEquals(spaces.slice(1), [['clerk', 'Given', '$0.75', '$0.75']])
  assertEquals(top.slice(1).map((r) => r.slice(0, 3)), [
    ['Conversation with Jeff', 'clerk', '$0.0005'],
  ])
  let open = [...page.document.querySelectorAll('.Table a')]
    .find((a) => a.textContent == 'Conversation with Jeff')!
  assertEquals(
    open.getAttribute('href'),
    `/admin/${eid}/operator/${rootOf(eid, jeff)}`,
  )
})

test('every conversation says its cost, requests and tokens, newest first', () => {
  assertEquals(runs[0].slice(0, 8), [
    'Conversation or helper',
    'Space',
    'Cost',
    'Requests',
    'Input',
    'Cached',
    'Output',
    'Wall time',
  ])
  assertEquals(runs[1].slice(0, 7), [
    'Conversation with Jeff',
    'clerk',
    '$0.0005',
    '1',
    '500',
    '0',
    '0',
  ])
})

test('what each request carries is listed piece by piece', () => {
  // The fixed part's tokens, shared among its pieces by their sizes: the
  // tool list first, its tools under it.
  assertEquals(fixed[0][0], 'The fixed part')
  assertEquals(fixed[1][0]!.startsWith('The tool list ('), true)
  assertEquals(fixed[1][2], '1')
})

let theirs = await get('/admin/spending', jeff)
test('nobody but the admin reads it', () => {
  assertEquals(theirs.status, 404)
})
