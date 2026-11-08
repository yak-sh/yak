// The admin's view of a space's Operator (admin.ts `operatorPage`): every
// person's conversation with it, each opening on the page its chat app
// draws, what its model was told and offered included, and for nobody else.

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

let p = platform('admin-operator', { SESSION_SECRET: 'secret' })
let dir = directoryOf(p.env.STORE)
let [jeff, root, eid] = [0, 0, 0].map(() => crypto.randomUUID())
let as = (person: string) => ({ 'x-yak-person': person, 'x-yak-role': 'owner' })
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
      items: [{ kind: 'assistant', text: 'Posted.' }],
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
    list.document.querySelector('.Rows_Name')!.getAttribute('href'),
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
  let column = talk.document.querySelector('#content > .Talk_Column')!
  assertEquals(column.hasAttribute('data-conversation'), true)
  assertEquals(texts(column, '.Talk_You'), ['Post the meeting.'])
  assertEquals(column.querySelector('.Talk_Via'), null)
  assertEquals(texts(talk.document, '.Talk_Reply'), ['Posted.'])
  let told = [...talk.document.querySelectorAll('.Talk_Told')]
  let summaries = told.map((d) => d.querySelector('summary')!.textContent!)
  assertEquals(summaries[0], 'The context the Operator was given')
  let tools = told.at(-1)!
  assertEquals(/^\d+ tools$/.test(summaries.at(-1)!), true)
  assertEquals(told.every((d) => !d.hasAttribute('open')), true)
  // Each tool by its name, opening on its description and its schema.
  assertEquals(tools.querySelectorAll('details > pre').length > 0, true)
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
  [...sessions.document.querySelectorAll('.Rows_Name')].map((a) =>
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
    sessions.document.querySelectorAll('.Rows_Name')[1]!.getAttribute('href'),
    `${at}/${rootOf(eid, jeff)}`,
  )
  // Each says its space, its state, and when it last changed, to the minute.
  assertEquals(
    texts(sessions.document, '.Rows_Meta').map((m) =>
      m!.replace(/\d+ \w+ \d{4}, \d\d:\d\d UTC$/, 'when')
    ),
    ['clerk · Waiting to start · when', 'clerk · Answered · when'],
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
test("operator_read reads any person's conversation for the admin, a request no session has taken included", () => {
  assertEquals(talked.status, 200)
  assertEquals(talked.value.entries.length > 0, true)
  assertEquals(waits.status, 200)
  assertEquals(
    waits.value.waiting.map((r: { doc: { body: string } }) => r.doc.body),
    ['Add a calendar.'],
  )
  assertEquals(nothing.status, 404)
})

// A long conversation reads back a page at a time from its newest 64, each
// answer naming the before that reads the page preceding it.
let long = rootOf(eid, jeff)
let said = Array.from({ length: 150 }, (_, i) => `said-${i}`)
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
