// The Operator's chat app, drawn in process for a conversation whose session
// called tools: what a person meets on the page, the list beside it, the
// address from before the chat app, Stop reaching the Operator, and a
// conversation the provider refused, which reads as ended. Each Operator has a
// name: a new one is given one, and a renamed one goes by its new name on the
// page and in its instructions.

import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { type Item, ModelError } from '@yaks/model'
import { directoryOf } from './directory.ts'
import { platform } from './testing.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { chatPage, operatorAnswer, operatorBody } from './operator-page.ts'
import { NAMES, pick } from './operator-name.ts'
import { chatPath, managed, managePath } from './route.ts'

let p = platform('operator-chat')
let person = crypto.randomUUID(), eid = crypto.randomUUID()
await directoryOf(p.env.STORE).apply({
  entities: [
    {
      entity: { eid: person },
      person: {},
      doc: { title: 'Jeff' },
      email: { address: 'jeff@example.com' },
    },
    {
      entity: { eid },
      space: { slug: 'clerk', store: 'clerk' },
      doc: { title: 'Township' },
    },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: eid, role: 'owner' },
    },
  ],
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })
let space = (await directoryOf(p.env.STORE).at(eid))!
let who = { person, role: 'owner' as const, space: eid }

let call = (name: string, args: unknown): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
let script = [
  call('graph_schema', {}),
  call('app_files', { op: 'list', app: 'notices' }),
  call('text_send', { text: 'Posted.' }),
  [{
    kind: 'assistant',
    text: 'The notice is **posted**.\n\n- Thursday at 7',
  } as Item],
]
// What Anthropic answered the first Operator request on Claude in Jeff's space.
let BREAKS = 'Any app errors recently?'
let REFUSED = JSON.stringify({
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message:
      'tools.26.custom.input_schema: input_schema does not support oneOf',
  },
})
let told = ''
let service = operatorService(
  p.env,
  who,
  operatorModel((req) =>
    (told = String(req.instructions ?? '')) &&
      JSON.stringify(req.items).includes(BREAKS)
      ? Promise.reject(
        new ModelError('request', `400 ${REFUSED}`, undefined, {
          body: REFUSED,
        }),
      )
      : Promise.resolve({
        id: crypto.randomUUID(),
        model: req.model,
        items: script.shift() ?? [{ kind: 'assistant', text: 'Done.' }],
        cost: 0.001,
      })
  ),
)
p.env.BUILDER = service.binding
let request = await receive(service.store, {
  space: eid,
  person,
  channel: 'chat',
}, 'Post a special meeting Thursday at 7 about the road millage.')
await service.drain()
let [asked] = await service.store.g.get([request])
let task = (asked.operator_answer as { task: string }).task

let at = managePath('operator', 'clerk')
let drawn = async (open: string) => {
  let response = await chatPage(p.env, space, who, open)
  let { document } = parseHTML(await response.text())
  return { code: response.status, document }
}
let page = await drawn(task)
let byRequest = await drawn(request)
let fresh = await drawn('new')
let gone = await drawn(crypto.randomUUID())
let text = (s: string) =>
  [...page.document.querySelectorAll(s)].map((e) => e.textContent?.trim())

test('a conversation opens in the chat app: its words, each step in plain words, and the reply', () => {
  assertEquals(page.code, 200)
  assertEquals(
    text('[data-title]'),
    ['Post a special meeting Thursday at 7 about the road millage.'],
  )
  assertEquals(text('.Talk_You'), [
    'Post a special meeting Thursday at 7 about the road millage.',
  ])
  // Each step said from the person's side, as what it did for them, or
  // tried to: the step names the app and the person it acted on.
  assertEquals(text('.Talk_Step > summary'), [
    'Read the schema',
    'Tried listing the files of notices',
    'Tried texting Jeff',
  ])
  assertEquals(
    page.document.querySelector('.Talk_Reply strong')?.textContent,
    'posted',
  )
  assertEquals(text('.Talk_Reply li'), ['Thursday at 7'])
  // A step opens on what it asked for in words; what its error said shows
  // only inside its closed Details, and what the model was told only in its
  // own frame.
  let said = page.document.querySelector('[data-conversation]')!.cloneNode(
    true,
  ) as Element
  said.querySelectorAll('.Talk_Trouble details, .Talk_Told').forEach((d) =>
    d.remove()
  )
  assertEquals(said.innerHTML.includes('<pre'), false)
  assertEquals(said.innerHTML.includes('&quot;'), false)
  assertEquals(text('.Talk_Trouble > p'), [
    'This step did not work, so the Operator went on without it.',
    'This step did not work, so the Operator went on without it.',
  ])
  assertEquals(text('.Talk_Step-no .Talk_Facts dt'), ['Op', 'App', 'Text'])
  // Done: nothing is said to be under way, and Stop is not offered.
  assertEquals(page.document.querySelector('[data-pending]'), null)
  assertEquals(
    page.document.querySelector('[data-stop]')?.textContent,
    'Stop',
  )
})

test('the chat app lists every conversation beside the open one, and links to the settings', () => {
  let item = page.document.querySelector('.Talk_Item[aria-current="page"]')
  assertEquals(item?.getAttribute('href'), chatPath('clerk', task))
  assertEquals(
    page.document.querySelector('.Talk_New')?.getAttribute('href'),
    chatPath('clerk'),
  )
  assertStringIncludes(page.document.querySelector('.Talk_Foot')!.innerHTML, at)
  assertEquals(
    byRequest.document.querySelector('[data-task]')?.getAttribute('data-task'),
    task,
  )
  assertEquals(
    byRequest.document.querySelector('[name=task]')?.getAttribute('value'),
    task,
  )
})

test('a new conversation asks what to do, and one that is gone says so', () => {
  assertEquals(fresh.code, 200)
  assertStringIncludes(
    fresh.document.querySelector('.Talk_Hello')!.textContent!,
    'What would you like done in Township?',
  )
  assertEquals(fresh.document.querySelector('[name=say]') != null, true)
  assertEquals(gone.code, 404)
  assertEquals(gone.document.querySelector('[name=say]'), null)
})

test("the chat app says whose Operator it is, and opens another space's", async () => {
  let spaces = [
    {
      slug: 'clerk',
      title: 'Township',
      owner: true,
      own: false,
      operator: space.operator,
    },
    { slug: 'jeff', title: 'Jeff', owner: true, own: true, operator: 'Wren' },
  ]
  // The test's Operator serves one store, so the other space shares it.
  let mill = { ...space, slug: 'mill', title: 'Mill Pond', operator: 'Fern' }
  for (let [at, name] of [[space, 'Township'], [mill, 'Mill Pond']] as const) {
    let { document } = parseHTML(
      await (await chatPage(p.env, at, who, 'new', spaces)).text(),
    )
    let said = (s: string) => document.querySelector(s)?.textContent?.trim()
    assertEquals(said('title'), `New conversation · ${at.operator} · yaks.app`)
    assertEquals(said('.Talk_Whose .Desk_Space b'), name)
    assertEquals(said('.Talk_Who'), `${at.operator}, ${name}’s Operator`)
    assertStringIncludes(
      said('.Talk_Hello')!,
      `You’re talking to ${at.operator}, ${name}’s Operator.`,
    )
    assertEquals(
      [...document.querySelectorAll('.Talk_Whose .Desk_Row small')].map((a) =>
        a.textContent
      ),
      [
        ...(at == mill ? ['Fern'] : []),
        space.operator,
        'Wren',
      ],
    )
    assertEquals(
      [...document.querySelectorAll('.Talk_Whose .Desk_Row')].map((a) =>
        a.getAttribute('href')
      ),
      [
        ...(at == mill ? [chatPath('mill')] : []),
        chatPath('clerk'),
        chatPath('jeff'),
      ],
    )
  }
})

let settings = parseHTML(await operatorBody(p.env, space, who)).document
test('the settings page links each conversation into the chat app, and draws none', () => {
  assertEquals(
    [...settings.querySelectorAll('.Rows_Name')].map((a) =>
      a.getAttribute('href')
    ),
    [chatPath('clerk', task)],
  )
  assertEquals(settings.querySelector('[data-task]'), null)
  assertEquals(settings.querySelector('[name=say]'), null)
})

let answer = (path: string, init?: RequestInit) =>
  operatorAnswer(
    new Request(new URL(path, 'https://yaks.app'), init),
    p.env,
    space,
    who,
  )
let moved = (await answer(`${at}?open=${task}`))!
let stopped = await (await answer(`${at}?stop=1`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ task }),
}))!.json()
let talk = await (await answer(`${at}?talk=${task}`))!.json()
test('an address from before the chat app is sent to its conversation there', () => {
  assertEquals(moved.status, 301)
  assertEquals(
    new URL(moved.headers.get('location')!).pathname,
    chatPath('clerk', task),
  )
  assertEquals(managed(chatPath('clerk', task)), {
    space: 'clerk',
    view: 'operator',
    open: task,
  })
  assertEquals(managed(chatPath('clerk')), {
    space: 'clerk',
    view: 'operator',
    open: 'new',
  })
  assertEquals(managed(`${at}/x`), null)
})

test('Stop from the page reaches the Operator', () => {
  assertEquals(stopped.task, task)
  assertEquals(stopped.stopped, false)
})

test('a conversation read again carries its title, its lines and the list', () => {
  assertEquals(talk.task, task)
  assertStringIncludes(talk.html, 'Talk_Reply')
  assertStringIncludes(talk.side, 'aria-current="page"')
})

let broke = await receive(service.store, {
  space: eid,
  person,
  channel: 'chat',
}, BREAKS)
await service.drain()
let [failed] = await service.store.g.get([broke])
let failedTask = (failed.operator_answer as { task: string }).task
let crashed = (await drawn(failedTask)).document
let reread = await (await answer(`${at}?talk=${failedTask}`))!.json()
test('a conversation the provider refused reads as ended: no Stop, nothing under way, plain words', () => {
  let thread = crashed.querySelector('[data-task]')!
  assertEquals(thread.hasAttribute('data-pending'), false)
  assertEquals(crashed.querySelector('[data-now]')?.textContent, '')
  assertEquals(
    crashed.querySelector('.Talk_Trouble > p')?.textContent,
    'The Operator could not get an answer from its model, so it stopped before replying. Send your message again to try once more.',
  )
  // Its error shows only inside the closed Details.
  let details = crashed.querySelector('.Talk_Trouble > details')!
  assertEquals(details.hasAttribute('open'), false)
  assertStringIncludes(details.textContent!, 'invalid_request_error')
  details.remove()
  assertEquals(thread.innerHTML.includes('invalid_request_error'), false)
  assertEquals(reread.html.includes('data-pending'), false)
  assertEquals(
    crashed.querySelector('.Talk_Item[aria-current="page"][data-pending]'),
    null,
  )
})

let dir = directoryOf(p.env.STORE)
let headers = { 'x-yak-person': person, 'x-yak-role': 'owner' }
let orchard =
  (await dir.at(await dir.mint(person, 'orchard', 'Orchard', headers)))!
let pond = (await dir.at(await dir.mint(person, 'pond', 'Pond', headers)))!
test('a new Operator is given a name, clear of the Operators its person already reaches', () => {
  assertEquals(space.operator, pick(eid))
  for (let s of [orchard, pond]) assertEquals(NAMES.includes(s.operator), true)
  assertEquals(new Set([space, orchard, pond].map((s) => s.operator)).size, 3)
})

let rename = (name: string) =>
  answer(`${at}?name=1`, {
    method: 'POST',
    body: new URLSearchParams({ name }),
  }).then((r) => r!.json().then((json) => ({ status: r!.status, json })))
let empty = await rename('  ')
let renamed = await rename('  Marlowe   Quince ')
let after = (await dir.at(eid))!
let again = parseHTML(
  await (await chatPage(p.env, after, who, 'new')).text(),
).document
let named = parseHTML(await operatorBody(p.env, after, who)).document
await receive(service.store, {
  space: eid,
  person,
  channel: 'chat',
}, 'Who are you?')
await service.drain()
test('a renamed Operator goes by its new name in its chat app, its settings and its instructions', () => {
  assertEquals(empty.status, 400)
  assertEquals(renamed.json, { name: 'Marlowe Quince' })
  assertEquals(after.operator, 'Marlowe Quince')
  assertEquals(
    again.querySelector('.Talk_Who')?.textContent,
    'Marlowe Quince, Township’s Operator',
  )
  assertEquals(
    named.querySelector('#name [name=name]')?.getAttribute('value'),
    'Marlowe Quince',
  )
  assertStringIncludes(told, 'You are Marlowe Quince, the Operator of clerk')
})
