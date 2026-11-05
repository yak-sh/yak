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
import { receive, rootOf } from './operator-channels.ts'
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
let texts = (d: Document, s: string) =>
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
  assertEquals(texts(talk.document, '.Talk_You'), ['Post the meeting.'])
  assertEquals(texts(talk.document, '.Talk_Reply'), ['Posted.'])
  let told = [...talk.document.querySelectorAll('.Talk_Told')]
  let summaries = told.map((d) => d.querySelector('summary')!.textContent!)
  assertEquals(summaries[0], 'What the Operator was told')
  assertEquals(
    /^The \d+ tools the Operator was offered$/.test(summaries[1]),
    true,
  )
  assertEquals(told.every((d) => !d.hasAttribute('open')), true)
  // Each tool by its name, opening on its description and its schema.
  assertEquals(told[1].querySelectorAll('details > pre').length > 0, true)
})

let missing = await get(`${at}/${crypto.randomUUID()}`)
let theirs = await get(`${at}/${rootOf(eid, jeff)}`, jeff)
test('an id that is no conversation says so, and nobody but the admin reads one', () => {
  assertEquals(missing.status, 404)
  assertEquals(theirs.status, 404)
})
