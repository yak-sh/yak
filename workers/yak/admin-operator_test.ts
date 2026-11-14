// The admin's view of a space's Operator (admin.ts `operatorPage`): every
// person's conversation with it, each opening on the page its chat app
// draws, what its model was told and offered included, and for nobody else.

import { test } from '@yaks/testing'
import { identityEid } from '@yaks/graph/identity'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { answer } from './admin.ts'
import { directoryOf, META } from './directory.ts'
import { platform } from './testing.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { rootOf } from './operator-root.ts'
import { conversationOf } from './operator-host.ts'
import { dates } from './dates.ts'
import { COOKIE, sign } from './lib/token.ts'

let p = platform('admin-operator', { SESSION_SECRET: 'secret' })
let dir = directoryOf(p.env.STORE)
let [jeff, root, eid] = [0, 0, 0].map(() => crypto.randomUUID())
let as = (person: string) => ({
  'x-yak-person': person,
  'x-yak-role': 'owner',
})
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
}, { ...as(root), 'x-yak-kernel': '1' })

// The space's Builder object, asked by the admin: what it hears is vouched
// as theirs, with the platform's administrative access.
let service = operatorService(
  p.env,
  { person: root, role: 'owner', space: eid, administrative: true },
  operatorModel(() =>
    Promise.resolve({
      id: crypto.randomUUID(),
      model: 'test-model',
      items: [{ kind: 'assistant', text: 'Posted T-12, not `T-9`.' }],
      cost: 0.001,
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

// The admin's own server says where an id it names opens.
await dir.apply({
  entities: [{
    entity: { eid: crypto.randomUUID() },
    mcp_server: {
      owner: root,
      name: 'tasks',
      url: 'https://tasks.example/mcp',
    },
    mentions: { url: 'https://tasks.example/{id}' },
  }],
}, { ...as(root), 'x-yak-kernel': '1' })

let at = `/admin/${eid}/operator`
let space = await get(`/admin/${eid}`)
let list = await get(at)
let talk = await get(`${at}/${rootOf(eid, jeff)}`)

test("a space's admin page opens on its Operator's conversations, every person's", () => {
  let link = [...space.document.querySelectorAll('a')]
    .find((a) => a.getAttribute('href') == at)
  assertEquals(!!link, true)
  assertEquals(list.status, 200)
  assertEquals(texts(list.document, '.Rows_Name'), ['Conversation with Jeff'])
  assertEquals(
    list.document.querySelector('.Rows_Name a')!.getAttribute('href'),
    `${at}/${rootOf(eid, jeff)}`,
  )
})

test('a conversation opens on what was said and everything its model was told and offered, closed', () => {
  assertEquals(talk.status, 200)
  assertEquals(texts(talk.document, '.Desk_Head h1'), [
    'Conversation with Jeff',
  ])
  // In the column the chat app draws a conversation in, and written in the
  // chat app, so marked by no channel.
  let column = talk.document.querySelector('.Desk_Content > .Talk_Column')!
  assertEquals(column.hasAttribute('data-conversation'), true)
  assertEquals(texts(column, '.Transcript_Bubble'), ['Post the meeting.'])
  assertEquals(column.querySelector('.Transcript_Via'), null)
  assertEquals(texts(talk.document, '.Transcript_Reply'), [
    'Posted T-12, not T-9.',
  ])
  let [context] = [...talk.document.querySelectorAll('.More')].filter((d) =>
    d.querySelector(':scope > summary')!.textContent!.startsWith('The context')
  )
  let told = [context, ...context.querySelectorAll('.More')]
  let summaries = told.map((d) => d.querySelector('summary')!.textContent!)
  assertEquals(summaries[0], 'The context the Operator was given')
  let tools = told.findLast((d) =>
    /^\d+ tools$/.test(d.querySelector('summary')!.textContent!)
  )!
  assertEquals(told.every((d) => !d.hasAttribute('open')), true)
  // Each tool by its name, opening on its description and its schema.
  assertEquals(tools.querySelectorAll('.More_Body > pre').length > 0, true)
})

test('an id in a reply opens where the admin’s own server says, and code keeps its ids words', () => {
  let links = [...talk.document.querySelectorAll('.Transcript_Reply a')]
  assertEquals(
    links.map((
      a,
    ) => [a.textContent, a.getAttribute('href'), a.getAttribute('target')]),
    [['T-12', 'https://tasks.example/T-12', '_blank']],
  )
})

let missing = await get(`${at}/${crypto.randomUUID()}`)
let theirs = await get(`${at}/${rootOf(eid, jeff)}`, jeff)
test('an id that is no conversation says so, and nobody but the admin reads one', () => {
  assertEquals(missing.status, 404)
  assertEquals(theirs.status, 404)
})

// A request no session has taken yet, listed beside the conversation.
let calendar = await receive(
  service.store,
  { space: eid, person: jeff, channel: 'chat' },
  'Add a calendar.',
)
let sessions = await get('/admin/sessions')
let opened = await Promise.all(
  [...sessions.document.querySelectorAll('.Rows_Name a')].map((a) =>
    get(a.getAttribute('href')!)
  ),
)
let notYours = await get('/admin/sessions', jeff)
test("the sessions page lists every space's Operator conversations, each by its space, opening on its page", () => {
  assertEquals(sessions.status, 200)
  assertEquals(texts(sessions.document, '.Rows_Name'), [
    'Add a calendar.',
    'Conversation with Jeff',
  ])
  assertEquals(
    opened.map((o) => [o.status, texts(o.document, '.Desk_Head h1')]),
    [[200, ['Add a calendar.']], [200, ['Conversation with Jeff']]],
  )
  assertEquals(
    sessions.document.querySelector('.Rows_Item:last-child .Rows_Name a')!
      .getAttribute('href'),
    `${at}/${rootOf(eid, jeff)}`,
  )
  // Each says its space, its state, and when it last changed.
  assertEquals(
    [...sessions.document.querySelectorAll('.Rows_Meta')].map((meta) => {
      let time = meta.querySelector('time')!
      assertEquals(
        Number.isFinite(Date.parse(time.getAttribute('datetime')!)),
        true,
      )
      assertEquals(!!time.textContent, true)
      let copy = meta.cloneNode(true) as Element
      copy.querySelector('time')!.textContent = 'when'
      return copy.textContent
    }),
    ['clerk · Waiting · when', 'clerk · Done · when'],
  )
  assertEquals(notYours.status, 404)
})

// operator_read, asked by the admin, finds each conversation as the admin
// page does: the person's conversation, and a request no session has taken.
let read = async (task: string, more = {}) => {
  let out = await service.binding.get(eid).fetch(
    new Request('https://builder/operator/read', {
      method: 'POST',
      headers: {
        'x-space-eid': eid,
        'x-yak-person': root,
        'x-yak-administrative': '1',
      },
      body: JSON.stringify({ task, ...more }),
    }),
  )
  return { status: out.status, value: await out.json() }
}
let talked = await read(rootOf(eid, jeff))
let waits = await read(calendar)
let nothing = await read(crypto.randomUUID())
let byLine = await read(talked.value.entries.at(-1).entity.eid)
test("operator_read reads any person's conversation for the admin, a request no session has taken included", () => {
  assertEquals(talked.status, 200)
  assertEquals(talked.value.entries.length > 0, true)
  assertEquals(waits.status, 200)
  assertEquals(
    waits.value.waiting.map((r: { doc: { body: string } }) => r.doc.body),
    ['Add a calendar.'],
  )
  assertEquals(nothing.status, 404)
  assertStringIncludes(nothing.value.message, 'operator_read with no task')
})
test('operator_read given any line of a conversation reads that conversation', () => {
  assertEquals(byLine.status, 200)
  assertEquals(byLine.value.entries, talked.value.entries)
})

// A long conversation reads back a page at a time from its newest 64, each
// answer naming the before that reads the page preceding it.
let long = rootOf(eid, jeff)
let said = Array.from({ length: 150 }, () => crypto.randomUUID())
let eids = (page: { entries: { entity: { eid: string } }[] }) =>
  page.entries.map((b) => b.entity.eid)
let first = eids(talked.value)
await service.store.g.apply(
  said.map((eid, i) => ({
    entity: { eid },
    entry: { session: long, seq: 1000 + i },
    content: { body: String(i) },
  })),
  { trusted: true },
)
let pages = []
for (let more = {}; more && pages.length < 9;) {
  let { value } = await read(long, more)
  pages.push(value)
  more = value.earlier && { before: value.earlier.before }
}
test('operator_read reads a long conversation back to its start, the newest 64 first', () => {
  let total = first.length + said.length
  assertEquals(pages.map((p) => [p.entries.length, p.earlier?.count]), [
    [64, total - 64],
    [64, total - 128],
    [total - 128, undefined],
  ])
  assertEquals(pages.toReversed().flatMap(eids), [...first, ...said])
})

let plain = await conversationOf(service.store, '/operator', long)
test('only the admin conversation puts recorded model prices beside messages', () => {
  let reply = talk.document.querySelector('.Transcript_Reply')!.closest(
    '.Annotated',
  )!
  assertEquals(texts(reply, '[data-cost]'), ['$0.001'])
  let yours = talk.document.querySelector('.Transcript_Bubble')!.closest(
    '.Annotated',
  )!
  assertEquals(texts(yours, '[data-cost]'), [])
  assertEquals(plain.html.includes('Annotated_Margin'), false)
  assertEquals(
    talk.document.querySelectorAll('.Annotated_Margin[title]').length,
    0,
  )
})

let [
  checkpoint,
  ask,
  beforeCompact,
  nextCompact,
  afterCompact,
  unpriced,
  unknown,
] = Array.from({ length: 7 }, () => crypto.randomUUID())
let atTime = '2026-11-09T23:00:00.000Z'
let model = identityEid('model', ['metadata-test-model'])
let entry = (id: string, seq: number, more: object) => ({
  entity: { eid: id },
  entry: { session: long, seq },
  created: { at: atTime },
  ...more,
})
await service.store.g.apply([
  { entity: { eid: model }, model: { name: 'metadata-test-model' } },
  entry(checkpoint, 2000, { checkpoint: { seq: 1149, through: said.at(-1) } }),
  entry(ask, 2001, {
    ask: { to: model, through: checkpoint },
    using: { model },
    cost: { dollars: 0.0123456 },
    usage: { input_tokens: 1200, cached_tokens: 1000, output_tokens: 80 },
  }),
  ...Array.from({ length: 67 }, (_, i) =>
    entry(crypto.randomUUID(), 2002 + i, {
      content: { body: `Message ${i}` },
    })),
  entry(beforeCompact, 2069, {
    output: { source: ask },
    content: { body: 'Before compact' },
  }),
  entry(nextCompact, 2070, { checkpoint: { seq: 2068 } }),
  entry(afterCompact, 2071, {
    output: { source: ask },
    content: { body: 'After compact' },
  }),
  entry(unpriced, 2072, { ask: { to: model, through: afterCompact } }),
  entry(unknown, 2073, {
    output: { source: unpriced },
    content: { body: 'Unpriced answer' },
  }),
], { trusted: true })
let metered = await get(`${at}/${long}`)
let margin = (id: string) =>
  metered.document.querySelector(`#row-${id} .Annotated_Margin`)!
test('entry numbering crosses an off-page compact and resets at the next one, with off-page recorded spend', () => {
  assertEquals(metered.status, 200)
  assertEquals(texts(margin(beforeCompact), '[data-sequence]'), ['#69'])
  assertEquals(texts(margin(afterCompact), '[data-sequence]'), ['#1'])
  assertEquals(texts(margin(afterCompact), '[data-cost]'), ['$0.012346'])
  assertEquals(texts(margin(unknown), '[data-sequence]'), ['#3'])
  assertEquals(texts(margin(unknown), '[data-cost]'), [])
  assertEquals(
    margin(unknown).getAttribute('data-tip')!.includes('price not recorded'),
    true,
  )
})

Object.defineProperties(globalThis, {
  innerWidth: { value: 1000, configurable: true },
  innerHeight: { value: 800, configurable: true },
})
test('the margin reveals request details in the kit tooltip on keyboard focus', () => {
  let document = metered.document
  let target = margin(afterCompact) as unknown as HTMLElement
  target.getBoundingClientRect = () => new DOMRect(20, 30, 20, 20)
  dates(document as unknown as Document)
  target.dispatchEvent(
    new document.defaultView!.Event('focusin', { bubbles: true }),
  )
  let tip = document.querySelector('[role=tooltip]')!
  assertEquals(tip.className, 'Overlay Tip')
  for (
    let detail of [
      'Entry 2071',
      'test-model',
      '$0.0123456',
      'Tokens in: 1200',
      'Cached: 1000',
      'Tokens out: 80',
    ]
  ) {
    assertEquals(tip.textContent!.includes(detail), true)
  }
})

test('an entry says when it was sent once, by the kit time on its line', () => {
  let row = metered.document.querySelector(`#row-${afterCompact}`)!
  assertEquals(
    margin(afterCompact).getAttribute('data-tip')!.includes(atTime),
    false,
  )
  assertEquals(
    [...row.querySelectorAll('time.Time')].map((t) =>
      t.getAttribute('datetime')
    ),
    [atTime],
  )
})
