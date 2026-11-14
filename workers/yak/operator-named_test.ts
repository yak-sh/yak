// An eid in a conversation's words reads on the chat page as the entity's
// id, the way the model reads it, wherever the page draws its lines.
import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { operatorMemory, sentRows } from './operator-testing.ts'
import { conversationOf } from './operator-host.ts'
import { mountTalk } from './operator-talk-browser.ts'
import { operatorVocab } from './operator-store.ts'
import { pageDocs } from './operator-words.ts'

let store = operatorMemory()
let session = crypto.randomUUID()
let task = crypto.randomUUID()
let loose = crypto.randomUUID()
let reply = crypto.randomUUID()
await store.g.apply([
  { entity: { eid: task }, doc: { title: 'Order the hymnals' }, task: {} },
  { entity: { eid: session }, session: { id: session } },
  {
    entity: { eid: reply },
    entry: { session, seq: 1 },
    content: { body: `Filed as ${task}; see [it](${task}), not ${loose}.` },
    output: {},
  },
])
let page = await conversationOf(store, '/chat', session)
let words = (html: string) =>
  parseHTML(`<div>${html}</div>`).document.querySelector(`.Transcript_Reply`)
    ?.textContent
let said = `Filed as T-1; see it, not #${
  loose.replaceAll('-', '').slice(0, 10)
}.`

test('the page draws an eid its store numbers as the id, else its handle', () => {
  equal(words(page.html), said)
})

test('the lines its socket sends say the same', () => {
  let lines = page.lines()!
  equal(lines.ids, { [task]: 'T-1' })
  equal(words(sentRows(lines).map((r) => r.html).join('')), said)
})

test('and so does the page, drawing those lines from their entries', () => {
  let { document } = parseHTML(
    `<html><body><div data-conversation>${page.html}</div></body></html>`,
  )
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  try {
    let box = document.querySelector('[data-conversation]') as HTMLElement
    let talk = mountTalk({ box, words: pageDocs(operatorVocab.docs) })
    talk.heard({ task: session, lines: page.lines()! })
    equal(words(box.innerHTML), said)
  } finally {
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
