// The chat page's conversation mounted over what the server drew
// (operator-talk-browser.ts), on a linkedom page: it changes nothing it was not told
// to, draws a step's lines from the entries its frame sends as the server
// draws them, a reply being written as a settled one, Stop at once, and a
// whole read that leaves out the person's words keeps them.
import { equal, test } from '@yaks/testing'
import { act } from '@yaks/react/testing'
import type { Bundle } from '@yaks/graph'
import { parseHTML } from 'linkedom'
import { namer } from '@yaks/session/conversation'
import { inputOf } from '@yaks/session/intake'
import { TAKE } from '@yaks/ux/conversation'
import { frame, talk } from './operator-view.ts'
import { mountTalk, type Talking } from './operator-talk-browser.ts'
import { pageGraph } from '@yaks/platform/page-graph'
import { operatorVocab } from './operator-store.ts'
import { pageDocs } from './operator-words.ts'
import type { Lines } from './operator-draw.ts'

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
  unfold?: (line: string) => Promise<Lines | null>,
  tab: 'new' | 'same' = 'new',
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
  let errors: string[] = []
  // Each page its own tab unless said: what another held is not in its graph.
  if (tab == 'new') pageGraph([], 'ada').close()
  let shown: Talking = mountTalk({
    box,
    words: docs,
    person: 'ada',
    older: (take) => void heard.push({ take }),
    unfold,
    onError: (e) => void errors.push(e.message),
    clock: () => at,
  })
  return {
    box,
    drawn,
    talk: shown,
    Event,
    errors,
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

test('a step that joins the one before it is drawn with it as one line, in its place', () => {
  using p = page([asked, call, result])
  let again = entry('again', 4, {
    call: { to: 'read', args: { path: 'stew' } },
  })
  let all = [asked, call, result, again]
  p.talk.heard(frame('task-1', all, names, 3).operator)
  equal(p.rows(), rowsOf(talk(task, all, names)))
  equal(p.rows().length, 2)
})

test('a reply as it is written is drawn as a settled reply, until its step lands', () => {
  using p = page([asked])
  p.talk.typed('It is the ')
  p.talk.typed('It is the **lentil** soup.')
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

test("the person's words are drawn the moment they are sent, until the store's line for them comes", () => {
  using p = page([asked, answer])
  p.talk.sent('request-1', 'And the bread?')
  let mine = entry(inputOf('request-1'), 5, {
    content: { body: 'And the bread?' },
  })
  equal(p.rows(), rowsOf(talk(task, [asked, answer, mine], names)))
  equal(p.box.querySelector('[data-now]')?.textContent, 'Sending…')
  equal(p.talk.read(talk(task, [asked, answer], names)), [])
  equal(p.rows().length, 3)
  p.talk.heard(frame('task-1', [asked, answer, mine], names, 2).operator)
  equal(p.rows(), rowsOf(talk(task, [asked, answer, mine], names)))
  equal(p.box.querySelector('[data-now]')?.textContent, 'Thinking…')
})

test('a send that failed takes its words back off', () => {
  using p = page([asked, answer])
  let back = p.talk.sent('request-1', '', ['soup.pdf'])
  equal(p.rows().length, 3)
  equal(p.rows()[2].includes('Attached: soup.pdf'), true)
  back()
  equal(p.rows(), rowsOf(talk(task, [asked, answer], names)))
})

test("a whole read keeps the person's words the page showed, and says it left them out", () => {
  using p = page([asked, call])
  let missing = p.talk.read(talk(task, [call, result], names))
  equal(missing, ['asked'])
  equal(p.rows().length, 2)
  equal(p.rows()[0], rowsOf(talk(task, [asked], names))[0])
})

test('the earlier lines the server did not draw are read when the reader asks', async () => {
  let heard: { take?: number }[] = []
  using p = page(words(5), heard, 2)
  equal(p.rows().length, 2)
  let more = p.box.querySelector('[data-task] > button')!
  equal(more.textContent, 'Show 3 earlier')
  await act(() =>
    void more.dispatchEvent(new p.Event('click', { bubbles: true }))
  )
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

// A page whose first line is what the model was told, and that line's fold
// as the person presses it: what it shows, and what the page asked for.
let told = entry('told', 1, {
  ask: {},
  sending: { instructions: '# Base\nBe kind.' },
})
let telling = (fails = 0, tab: 'new' | 'same' = 'new') => {
  let all = [told, entry('said', 2, { content: { body: 'Hello' } })]
  let asked: string[] = []
  let answers: (() => void)[] = []
  let p = page(all, [], undefined, (line) => {
    asked.push(line)
    let { lines } = frame('task-1', all, names, 0).operator
    let one = { ...lines, lines: lines.lines.filter((l) => l.id == line) }
    return new Promise((done, fail) =>
      answers.push(() =>
        asked.length <= fails ? fail(new Error('offline')) : done(one)
      )
    )
  }, tab)
  let fold = () => p.box.querySelector('#row-told [data-lazy]')!
  let press = (at: Element) =>
    at.dispatchEvent(new p.Event('click', { bubbles: true, cancelable: true }))
  return {
    p,
    asked,
    press: () => press(fold().querySelector('summary')!),
    retry: () => press(fold().querySelector('.More_Body button')!),
    // the fetches asked for answered, and the page's drawing after them
    answer: async () => {
      answers.splice(0).forEach((a) => a())
      await new Promise((done) => setTimeout(done, 0))
    },
    // what it shows: none of what a fold closed inside it holds
    shown: () => {
      let body = fold().querySelector('.More_Body')!.cloneNode(true) as Element
      for (let b of body.querySelectorAll('details:not([open]) > .More_Body')) {
        b.remove()
      }
      return {
        open: fold().hasAttribute('open'),
        says: body.textContent!.trim(),
      }
    },
  }
}

test('a fold the server drew holding only Loading opens at once, its line fetched, and closes when pressed again', async () => {
  let t = telling()
  using _p = t.p
  equal(t.shown(), { open: false, says: 'Loading…' })
  t.press()
  equal(t.shown(), { open: true, says: 'Loading…' })
  await t.answer()
  equal(t.asked, ['told'])
  equal(t.shown(), { open: true, says: 'Base' })
  t.press()
  equal(t.shown().open, false)
  t.press()
  equal(t.shown(), { open: true, says: 'Base' })
  equal(t.asked, ['told'])
})

test('a conversation visited again in the same tab is drawn as the server drew it', async () => {
  let first = telling()
  first.press()
  await first.answer()
  equal(first.shown(), { open: true, says: 'Base' })
  first.p.talk.close()
  first.p[Symbol.dispose]()
  let again = telling(0, 'same')
  using _p = again.p
  equal(again.shown(), { open: false, says: 'Loading…' })
  again.press()
  await again.answer()
  equal(again.shown(), { open: true, says: 'Base' })
})

test('a fold whose line could not be fetched says so, and its retry opens it', async () => {
  let t = telling(1)
  using _p = t.p
  t.press()
  await t.answer()
  equal(t.shown(), { open: true, says: 'This could not be opened. Try again' })
  equal(t.p.errors, ['offline'])
  t.retry()
  equal(t.shown(), { open: true, says: 'Loading…' })
  await t.answer()
  equal(t.shown(), { open: true, says: 'Base' })
  t.press()
  equal(t.shown().open, false)
})
