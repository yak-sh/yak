import { assert, assertEquals } from '@std/assert'
import { client } from '@yaks/client'
import { desk, draftDoc, drafts } from '@yaks/draft'
import { mint } from '@yaks/graph'
import { test, tick } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { parseHTML } from 'linkedom'
import { h, render } from 'preact'
import { completion, type Result } from './completion.ts'
import { docs, uxDoc } from './vocab.ts'

let kept = () =>
  desk(client(loadVocab([draftDoc]), [drafts()], { vault: false }), {
    by: () => 'writer',
  })
let offers = (text: string, caret: number): Result => ({
  from: 0,
  to: caret,
  cands: text == 'pe'
    ? [{ text: 'pear', kind: 'fruit' }, { text: 'peach', kind: 'fruit' }]
    : [],
  whole: false,
})

test('generic completion keeps choices in Completion and text in the host draft', () => {
  let front = client(loadVocab(docs), [], { vault: false })
  let drafts = kept()
  let id = mint()
  let c = completion(front, { drafts, complete: offers })
  c.type(id, 'pe tail', 2)
  assertEquals(front.ent(id)?.Completion, {
    caret: 2,
    from: 0,
    to: 2,
    cands: [],
    pick: 0,
  })
  c.type(id, 'pe')
  assertEquals(drafts.text(id), 'pe')
  assertEquals(c.row(id)?.cands.map((c) => c.text), ['pear', 'peach'])
  c.press(id, 'ArrowDown')
  assert(c.press(id, 'Enter'))
  assertEquals(drafts.text(id), 'peach')
  let other = completion(client(loadVocab(docs), [], { vault: false }), {
    drafts,
    complete: offers,
  })
  assertEquals(other.text(id), 'peach')
  assertEquals(other.row(id)?.cands, [])
  c.dispose()
  other.dispose()
})

test('completion can use a host-named state component and replace only the offered span', () => {
  let vocab = loadVocab({ $defs: { Local: uxDoc.$defs!.Completion } })
  let front = client(vocab, [], { vault: false })
  let c = completion(front, {
    drafts: kept(),
    component: 'Local',
    complete: () => ({
      from: 4,
      to: 6,
      cands: [{ text: 'pear', kind: 'fruit' }],
      whole: false,
    }),
  })
  let id = mint()
  c.type(id, 'eat pe now', 6)
  assert(front.ent(id)?.Local)
  assertEquals(front.ent(id)?.Completion, undefined)
  c.accept(id)
  assertEquals(c.text(id), 'eat pear now')
  assertEquals(c.row(id)?.caret, 8)
  c.dispose()
})

test('late completion cannot reopen a dismissed list or overwrite a newer identical request', async () => {
  let pending: ((r: Result) => void)[] = []
  let c = completion(client(loadVocab(docs), [], { vault: false }), {
    drafts: kept(),
    complete: () => new Promise<Result>((done) => pending.push(done)),
  })
  let id = mint()
  c.type(id, 'pe')
  c.type(id, 'pe')
  pending[1](offers('pe', 2))
  await tick()
  pending[0]({ ...offers('pe', 2), cands: [{ text: 'old', kind: 'stale' }] })
  await tick()
  assertEquals(c.row(id)?.cands[0].text, 'pear')
  c.type(id, 'pe')
  c.dismiss(id)
  pending[2](offers('pe', 2))
  await tick()
  assertEquals(c.row(id)?.cands, [])
  c.dispose()
})

test('an imperative input binds to generic Choices, accepts at its caret, and cleans up', async () => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document, window } = parseHTML('<input><main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  Object.assign(window.HTMLInputElement.prototype, {
    setSelectionRange(this: { selectionStart: number }, at: number) {
      this.selectionStart = at
    },
  })
  let root = document.querySelector('main')!
  let input = document.querySelector('input')!
  let c = completion(client(loadVocab(docs), [], { vault: false }), {
    drafts: kept(),
    complete: offers,
  })
  let id = mint()
  c.set(id, 'pe')
  let off = c.bind(id, input)
  let heard: string[] = []
  input.addEventListener('input', () => heard.push(input.value))
  try {
    assertEquals(input.value, 'pe', 'bind restores the host draft')
    render(h(c.List, { id, anchor: { current: input } }), root)
    input.setSelectionRange(2, 2)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    await tick()
    assertEquals(root.querySelectorAll('.Choices_Item').length, 2)
    let key = Object.assign(new window.Event('keydown', { cancelable: true }), {
      key: 'Tab',
      shiftKey: true,
    })
    input.dispatchEvent(key)
    assertEquals(key.defaultPrevented, false)
    let click = new window.Event('mousedown', {
      bubbles: true,
      cancelable: true,
    })
    root.querySelectorAll('.Choices_Item')[1].dispatchEvent(click)
    await tick()
    assert(click.defaultPrevented)
    assertEquals(input.value, 'peach')
    assertEquals(input.selectionStart, 5)
    assertEquals(heard, ['pe', 'peach'])
    assertEquals(c.text(id), 'peach')
    c.set(id, 'pe')
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
    let tab = Object.assign(new window.Event('keydown', { cancelable: true }), {
      key: 'Tab',
    })
    input.dispatchEvent(tab)
    assert(tab.defaultPrevented)
    assertEquals(c.text(id), 'pear')
    off()
    input.value = 'not bound'
    input.dispatchEvent(new window.Event('input'))
    assertEquals(c.text(id), 'pear')
  } finally {
    off()
    c.dispose()
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
})

test('a rejected provider keeps the draft and cannot clear newer choices', async () => {
  let pending: { done: (r: Result) => void; fail: (reason: Error) => void }[] =
    []
  let c = completion(client(loadVocab(docs), [], { vault: false }), {
    drafts: kept(),
    complete: () =>
      new Promise<Result>((done, fail) => pending.push({ done, fail })),
  })
  let id = mint()
  try {
    c.type(id, 'pe')
    pending[0].fail(new Error('source unavailable'))
    await tick()
    assertEquals(c.text(id), 'pe')
    assertEquals(c.row(id)?.cands, [])
    c.type(id, 'pe')
    c.type(id, 'pe')
    pending[2].done(offers('pe', 2))
    await tick()
    pending[1].fail(new Error('older source unavailable'))
    await tick()
    assertEquals(c.row(id)?.cands.map((c) => c.text), ['pear', 'peach'])
    assertEquals(c.text(id), 'pe')
  } finally {
    c.dispose()
  }
})

for (let tag of ['input', 'textarea']) {
  test(`a bound ${tag} refreshes its reactive list only when the caret moves`, async () => {
    let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
    let { document, window } = parseHTML(`<${tag}></${tag}><main></main>`)
    Object.defineProperty(globalThis, 'document', {
      value: document,
      configurable: true,
    })
    let input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      tag,
    )!
    input.setSelectionRange = (at: number) => {
      input.selectionStart = at
    }
    let root = document.querySelector('main')!
    let asked: number[] = []
    let c = completion(client(loadVocab(docs), [], { vault: false }), {
      drafts: kept(),
      complete: (_text, caret) => {
        asked.push(caret)
        return {
          from: 0,
          to: caret,
          cands: [{ text: `at ${caret}`, kind: 'caret' }],
          whole: false,
        }
      },
    })
    let id = mint()
    c.set(id, 'pe tail')
    let off = c.bind(id, input)
    let rows = () =>
      [...root.querySelectorAll('.Choices_Text')].map((n) => n.textContent)
    try {
      render(h(c.List, { id, anchor: { current: input } }), root)
      for (
        let [at, event] of [[2, 'click'], [4, 'select'], [3, 'keyup']] as const
      ) {
        input.setSelectionRange(at, at)
        input.dispatchEvent(new window.Event(event))
        await tick()
        assertEquals(c.row(id)?.caret, at)
        assertEquals(rows(), [`at ${at}`])
        assertEquals(
          c.text(id),
          'pe tail',
          'moving the caret preserves the draft',
        )
        input.dispatchEvent(new window.Event(event))
        assertEquals(asked.length, at == 2 ? 1 : at == 4 ? 2 : 3)
      }
      input.dispatchEvent(
        Object.assign(new window.Event('keydown', { cancelable: true }), {
          key: 'Escape',
        }),
      )
      for (let event of ['keyup', 'select', 'click']) {
        input.dispatchEvent(new window.Event(event))
      }
      await tick()
      assertEquals(rows(), [], 'Escape stays dismissed with an unchanged caret')
      assertEquals(asked, [2, 4, 3])
      input.setSelectionRange(2, 2)
      input.dispatchEvent(new window.Event('select'))
      await tick()
      assertEquals(rows(), ['at 2'], 'a real movement reopens completion')
      off()
      input.setSelectionRange(1, 1)
      for (let event of ['click', 'select', 'keyup']) {
        input.dispatchEvent(new window.Event(event))
      }
      await tick()
      assertEquals(
        asked,
        [2, 4, 3, 2],
        'cleanup removes selection listeners too',
      )
    } finally {
      off()
      c.dispose()
      render(null, root)
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else delete (globalThis as { document?: unknown }).document
    }
  })
}
