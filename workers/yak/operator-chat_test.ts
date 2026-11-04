// The Operator's chat app, drawn in process for a conversation whose session
// called tools: what a person meets on the page, the list beside it, the
// address from before the chat app, and Stop reaching the Operator.

import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import type { Item } from '@yaks/model'
import { directoryOf } from './directory.ts'
import { platform } from './testing.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { receive } from './operator-channels.ts'
import { chatPage, operatorAnswer, operatorBody } from './operator-page.ts'
import { chatPath, managed, managePath } from './route.ts'

let p = platform('operator-chat')
let person = crypto.randomUUID(), eid = crypto.randomUUID()
await directoryOf(p.env.STORE).apply({
  entities: [
    { entity: { eid: person }, person: {} },
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
  [{
    kind: 'assistant',
    text: 'The notice is **posted**.\n\n- Thursday at 7',
  } as Item],
]
let service = operatorService(
  p.env,
  who,
  operatorModel((req) =>
    Promise.resolve({
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
  // One step that answered and one that did not, each said as what it did.
  assertEquals(text('.Talk_Step > summary'), [
    'Read the schema',
    'Tried to list app files',
  ])
  assertEquals(
    page.document.querySelector('.Talk_Reply strong')?.textContent,
    'posted',
  )
  assertEquals(text('.Talk_Reply li'), ['Thursday at 7'])
  // A step opens on what it asked for in words, never its JSON.
  let html = page.document.querySelector('[data-conversation]')!.innerHTML
  assertEquals(html.includes('<pre'), false)
  assertEquals(html.includes('&quot;'), false)
  assertEquals(text('.Talk_Step-no .Talk_Facts dt'), ['Op', 'App'])
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
    'What would you like done?',
  )
  assertEquals(fresh.document.querySelector('[name=say]') != null, true)
  assertEquals(gone.code, 404)
  assertEquals(gone.document.querySelector('[name=say]'), null)
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
