import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { parseHTML } from 'linkedom'
import { operatorMemory, sentRows } from './operator-testing.ts'
import {
  conversationOf,
  operatorFrames,
  operatorRequest,
} from './operator-host.ts'
import type { Operator } from './operator.ts'
import type { Lines } from './operator-draw.ts'
import { mountTalk } from './operator-talk-browser.ts'
import { operatorVocab } from './operator-store.ts'
import { pageDocs } from './operator-words.ts'

let store = operatorMemory()
let [
  space,
  person,
  other,
  root,
  chat,
  privateRoot,
  privateChat,
  notice,
  foreign,
  input,
  reply,
] = Array.from({ length: 11 }, () => crypto.randomUUID())
let entry = (session: string, eid: string, comps: object): Bundle => ({
  entity: { eid },
  entry: { session },
  ...comps,
})
await store.g.apply([
  { entity: { eid: space } },
  ...[person, other].map((eid) => ({ entity: { eid }, person: {} })),
  ...[[root, person], [privateRoot, other]].map(([eid, owner]) => ({
    entity: { eid },
    session: {},
    operator_session: { person: owner, space },
  })),
  ...[[chat, root], [privateChat, privateRoot]].map(([eid, parent]) => ({
    entity: { eid },
    session: {},
    spawned: { parent, notice: true, quiet: 300000 },
    operator_session: { person: parent == root ? person : other, space },
  })),
  entry(root, crypto.randomUUID(), {
    content: { body: 'Main conversation stays here.' },
  }),
  entry(chat, input, {
    content: { body: 'Check the calendar.' },
    entry: { session: chat, from: 'an outside agent' },
  }),
  // What the chat's model was told: the Operator's own context.
  entry(chat, crypto.randomUUID(), {
    ask: {},
    sending: { instructions: 'Answer calendar questions briefly.' },
  }),
  entry(chat, reply, { output: {}, content: { body: 'Tuesday is free.' } }),
  entry(privateChat, crypto.randomUUID(), {
    content: { body: 'Another person’s private words.' },
  }),
], { trusted: true })
let named = (id: string) => Promise.resolve(id == person ? 'Ada' : 'Bea')
let read = () => conversationOf(store, '/operator', root, named)
let before = await read()
let sent: { operator: { task: string; refresh?: boolean; lines?: Lines } }[] =
  []
let attachment = {
  operator: true,
  lines: true,
  person,
  space,
  called: 'Pip',
  opens: '/operator',
}
let frames = operatorFrames(store, () => [{
  deserializeAttachment: () => attachment,
  send: (text) => sent.push(JSON.parse(text)),
}], named)
await frames.tell(chat)
let privateFrames = sent.splice(0)
let closed =
  'Asked: Check the calendar. Done: Tuesday is free. Open: choose a time.'
await store.g.apply([
  entry(root, notice, {
    notice: { child: chat },
    delivery: { child: chat, outcome: 'settled', through: reply },
    content: { body: closed },
  }),
  // A notice pointing outside this parent must never expand another person’s entries.
  entry(root, foreign, {
    notice: {},
    delivery: { child: privateChat, outcome: 'settled' },
    content: { body: 'An unrelated report.' },
  }),
], { trusted: true })
let first = await read()
// The page opening the sub-thread's fold asks for its line whole.
let opening = (line: string) =>
  conversationOf(
    store,
    '/operator',
    root,
    named,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    line,
  ).then((c) => c.lines(line))
// The notice's line: the run of steps it is drawn in.
let line = first.lines()!.lines.find((l) => l.of?.includes(notice))!.id
let unfolded = await opening(line)
await frames.tell(root)
let delivered = sent.splice(0)
let latest =
  'Asked: Check the calendar. Done: chose Tuesday at noon. Open: nothing.'
await store.g.apply([{
  entity: { eid: notice },
  content: { body: latest },
  delivery: { through: input },
}], { trusted: true })
let refresh = sent.splice(0)
let updated = await read()
let denied = await operatorRequest(
  { store, named } as unknown as Operator,
  { person: other, space, role: 'owner' },
  '/operator/conversation',
  { open: root },
  () => undefined,
)

let deniedBody = JSON.stringify(await denied!.json())
let documentOf = (html: string) => parseHTML(html).document
let foldOf = (html: string) =>
  documentOf(html).querySelector(`#row-${notice} details`)!

test('a sub-thread appears once at its closing notice, a step named for whom it was with, drawn as it opens', () => {
  assertEquals(before.html.includes('Check the calendar'), false)
  assertEquals(privateFrames.some((f) => f.operator.task == root), false)
  let document = documentOf(first.html)
  assertEquals(document.querySelectorAll(`#row-${notice}`).length, 1)
  let fold = foldOf(first.html)
  assertEquals(fold.hasAttribute('open'), false)
  assertEquals(
    fold.querySelector(':scope > summary')!.textContent,
    'Chatted with an outside agent for Ada',
  )
  assertEquals(fold.textContent!.includes(closed), false)
  assertEquals(
    !!document.querySelector(`#row-${notice} .Transcript_Meta time[datetime]`),
    true,
  )
  assertEquals(fold.hasAttribute('data-lazy'), true)
  assertEquals(fold.textContent!.includes('Tuesday is free.'), false)
  let chat = JSON.stringify(unfolded?.threads?.[notice]?.lines)
  assertStringIncludes(chat, 'Check the calendar.')
  assertStringIncludes(chat, 'Tuesday is free.')
  assertEquals(chat.includes('Main conversation stays here'), false)
  assertEquals(chat.includes('calendar questions briefly'), false)
  assertEquals(first.lines(line)?.threads?.[notice]?.lines, undefined)
  assertEquals(first.html.includes('Another person’s private words'), false)
})

let socket = delivered.find((f) => f.operator.task == root && f.operator.lines)!
let row = sentRows(JSON.parse(JSON.stringify(socket.operator.lines))).find((
  r,
) => r.html.includes(`row-${notice}`))!
let socketFold = foldOf(row.html).outerHTML
let pageFold = foldOf(first.html).outerHTML
// The page as it was drawn, the sub-thread opened, then read again whole.
let page = parseHTML(
  `<html><body><div data-conversation>${first.html}</div></body></html>`,
)
let document = page.document
let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
Object.defineProperty(globalThis, 'document', {
  value: document,
  configurable: true,
})
// The sub-thread's fold once it shows the chat, its line fetched.
let foldText = () =>
  document.querySelector(`#row-${notice} details`)!.textContent!
let drawn = async () => {
  for (let i = 0; i < 50 && !foldText().includes('Tuesday'); i++) {
    await new Promise((done) => setTimeout(done, 10))
  }
}
let calls: string[] = []
let talk = mountTalk({
  box: document.querySelector('[data-conversation]') as HTMLElement,
  words: pageDocs(operatorVocab.docs),
  unfold: (l: string) => (calls.push(l), opening(l)),
})
let opened = document.querySelector(`#row-${notice} details`)!
opened.querySelector('summary')!.dispatchEvent(
  new page.Event('click', { bubbles: true, cancelable: true }),
)
await drawn()
let drawnOpen = foldText()
talk.read(updated.html)
await drawn()
if (prior) Object.defineProperty(globalThis, 'document', prior)
else Reflect.deleteProperty(globalThis, 'document')

test('page and socket render the same sub-thread entries and preserve its open state on refresh', () => {
  assertEquals(socketFold, pageFold)
  assertStringIncludes(drawnOpen, 'Tuesday is free.')
  assertEquals(calls, [line, line], 'opened, then read again')
  let fold = document.querySelector(`#row-${notice} details`)!
  assertEquals(fold.hasAttribute('open'), true)
  assertStringIncludes(fold.textContent!, 'Tuesday is free.')
  assertEquals(
    refresh.some((f) => f.operator.task == root && f.operator.refresh),
    true,
  )
})

test('another space member cannot read the conversation holding the sub-thread', () => {
  assertEquals(denied?.status, 404)
  assertEquals(deniedBody.includes('Tuesday'), false)
})
