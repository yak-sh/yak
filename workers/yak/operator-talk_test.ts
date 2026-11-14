// The chat page's conversation mounted over what the server drew
// (operator-talk-browser.ts), on a linkedom page: it changes nothing it was not told
// to, draws a step's lines from the entries its frame sends as the server
// draws them, a reply being written as a settled one, Stop at once, and a
// whole read that leaves out the person's words keeps them.
import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { parseHTML } from 'linkedom'
import { namer } from '@yaks/session/conversation'
import { TAKE } from '@yaks/ux/conversation'
import { frame, talk } from './operator-view.ts'
import { mountTalk, type Talking } from './operator-talk-browser.ts'
import { operatorVocab } from './operator-store.ts'
import { pageDocs } from './operator-words.ts'

let task = { entity: { eid: 'task-1' } } as Bundle
let at = '2026-11-13T12:00:00.000Z'
let entry = (eid: string, seq: number, comps: object): Bundle => ({
  entity: { eid },
  entry: { session: 'session-1', seq },
  created: { at },
  ...comps,
})
let names = namer({})
let docs = pageDocs(operatorVocab.docs)
let asked = entry('asked', 1, { content: { body: 'Find the recipe' } })
let call = entry('call', 2, { call: { to: 'read', args: { path: 'soup' } } })
let result = entry('result', 3, {
  result: { call: 'call' },
  content: { body: 'Lentil soup' },
})
let answer = entry('answer', 4, {
  output: {},
  content: { body: 'It is the **lentil** soup.' },
})
let words = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => entry(`said-${i}`, i + 1, { content: { body: `Line ${i}` } }),
  )

// An element as HTML, its attributes in one order whoever wrote them: the
// server's string and the page's own drawing put them in different orders.
let canon = (e: Element): string =>
  `<${e.localName}${
    [...e.attributes].map((a) => ` ${a.name}="${a.value}"`).sort().join('')
  }>${
    [...e.childNodes].map((n) =>
      n.nodeType == 1 ? canon(n as Element) : n.textContent
    ).join('')
  }</${e.localName}>`

// A page drawn by the server, its last `take` lines, mounted, and what it
// shows.
let page = (
  entries: Bundle[],
  heard: { take?: number }[] = [],
  take?: number,
) => {
  let { document, Event } = parseHTML(
    `<html><body><main id="content"><div data-conversation>${
      talk(task, entries, names, {}, { take })
    }</div></main></body></html>`,
  )
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let box = document.querySelector('[data-conversation]') as HTMLElement
  let drawn = box.innerHTML
  let shown: Talking = mountTalk({
    box,
    words: docs,
    older: (take) => void heard.push({ take }),
    clock: () => at,
  })
  return {
    box,
    drawn,
    talk: shown,
    Event,
    rows: () =>
      [...box.querySelector('.Transcript_Lines')!.children].map(canon),
    [Symbol.dispose]: () => {
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else Reflect.deleteProperty(globalThis, 'document')
    },
  }
}
let rowsOf = (html: string) =>
  [
    ...parseHTML(`<main>${html}</main>`).document.querySelector(
      '.Transcript_Lines',
    )!.children,
  ].map(canon)

// Each path run once as the file loads, so a case times its own act.
{
  using warm = page([asked, call])
  warm.talk.typed('Hello')
  warm.talk.heard(frame('task-1', [asked, call, result], names, 2).operator)
  warm.talk.read(talk(task, [asked, call, result, answer], names))
  canon(warm.box)
}

test('mounted over what the server drew, it changes nothing', () => {
  using p = page([asked, call])
  equal(p.box.innerHTML, p.drawn)
  equal(p.talk.task(), 'task-1')
  equal(p.talk.working(), true)
})

test("a step's lines are drawn from the entries its frame sends, as the server draws them", () => {
  using p = page([asked, call])
  let all = [asked, call, result, answer]
  p.talk.heard(frame('task-1', all, names, 2).operator)
  equal(p.rows(), rowsOf(talk(task, all, names)))
  equal(p.talk.working(), false)
})

test('a reply as it is written is drawn as a settled reply, until its step lands', () => {
  using p = page([asked])
  p.talk.typed('It is the ')
  p.talk.typed('**lentil** soup.')
  let typed = p.box.querySelector('.Transcript_Lines > :last-child')!
  equal(typed.querySelector('.Transcript_Reply strong')?.textContent, 'lentil')
  equal(typed.querySelector('time') != null, true)
  equal(p.box.querySelector('[data-now]')?.textContent, 'Typing…')
  p.talk.heard(frame('task-1', [asked, answer], names, 1).operator)
  equal(p.rows(), rowsOf(talk(task, [asked, answer], names)))
})

test('Stop takes effect at once, and is put back when it fails', () => {
  using p = page([asked, call])
  let undo = p.talk.stopped()
  equal(p.box.querySelector('[data-now]')?.textContent, 'Stopped.')
  equal(p.box.querySelector('[data-pending]'), null)
  undo()
  equal(p.box.querySelector('[data-pending]') != null, true)
})

test("a whole read keeps the person's words the page showed, and says it left them out", () => {
  using p = page([asked, call])
  let missing = p.talk.read(talk(task, [call, result], names))
  equal(missing, ['asked'])
  equal(p.rows().length, 2)
  equal(p.rows()[0], rowsOf(talk(task, [asked], names))[0])
})

test('the earlier lines the server did not draw are read when the reader asks', () => {
  let heard: { take?: number }[] = []
  using p = page(words(5), heard, 2)
  equal(p.rows().length, 2)
  let more = p.box.querySelector('[data-task] > button')!
  equal(more.textContent, 'Show 3 earlier')
  more.dispatchEvent(new p.Event('click'))
  equal(heard, [{ take: 2 * TAKE }])
  p.talk.read(talk(task, words(5), names, {}, { take: 2 * TAKE }))
  equal(p.rows().length, 5)
  equal(p.box.querySelector('[data-task] > button'), null)
})

test("the person's words a step sent are kept when a whole read leaves them out", () => {
  let more = entry('more', 3, { content: { body: 'And the bread' } })
  using p = page([asked, call])
  p.talk.heard(frame('task-1', [asked, call, more], names, 2).operator)
  equal(p.talk.read(talk(task, [asked, call], names)), ['more'])
  equal(p.rows(), rowsOf(talk(task, [asked, call, more], names)))
})

test('a read of the newest lines keeps the earlier ones the page holds, and misses none', () => {
  using p = page(words(5))
  equal(p.talk.read(talk(task, words(6), names, {}, { take: 2 })), [])
  equal(p.rows(), rowsOf(talk(task, words(6), names)))
  equal(p.box.querySelector('[data-task] > button'), null)
})
