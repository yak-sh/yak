import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { client, stash, type Vault } from '@yaks/client'
import { type Cand, type Source } from '@yaks/query'
import { print } from '@yaks/tui/print'
import { loadVocab } from '@yaks/vocab'
import { parseHTML } from 'linkedom'
import { h, render } from 'preact'
import { filters, type Opts } from './mod.ts'
import { docs } from './vocab.ts'

// A query language of one component, and a page graph holding its fields.
let vocab = loadVocab({
  $defs: {
    task: {
      component: true,
      properties: {
        status: { type: 'string', enum: ['open', 'done'] },
        owner: { type: 'string', ref: 'entity' },
      },
    },
  },
})
// A field in a page of its own; given a tab, the page is one load of it.
let field = (opts: Partial<Opts> = {}, tab: Vault | false = false) =>
  filters(client(loadVocab(docs), [], { vault: false, tab }), {
    vocab,
    ...opts,
  })
let words = (cands: Cand[] = []) => cands.map((c) => c.text)
// The painter's styles, to read the words under them.
// deno-lint-ignore no-control-regex
let STYLE = /\x1b\[[0-9;]*m/g
// A promise's answer, and Preact's paint of a signal, land a task later.
let settle = () => new Promise((r) => setTimeout(r))

test('typing offers what can come next, and the keys walk and take it', () => {
  let f = field()
  f.type('q', '.task .st')
  assertEquals(words(f.row('q')?.cands), ['.task .status'.slice(6)])
  assertEquals(f.press('q', 'Tab'), true)
  // Taking a property rolls on to what may follow it.
  assertEquals(f.text('q'), '.task .status')
  assertEquals(words(f.row('q')?.cands).slice(0, 2), ['.status=', '.status!='])
  f.press('q', 'Tab')
  assertEquals(words(f.row('q')?.cands), ['.status=open', '.status=done'])
  f.press('q', 'ArrowDown')
  f.press('q', 'ArrowDown') // held to the list
  f.press('q', 'Enter')
  assertEquals(f.row('q')?.caret, '.task .status=done'.length)
  assertEquals(f.text('q'), '.task .status=done')
})

test('a reload of the tab brings back what was typed, and not its list', () => {
  let tab = stash()
  field({}, tab).type('q', '.task .st')
  let next = field({}, tab)
  assertEquals(next.text('q'), '.task .st')
  assertEquals(next.row('q')?.cands, [])
  assertEquals(field({}, stash()).row('q'), undefined, 'a new tab is empty')
})

test('Enter takes a word to where it reads whole, then keeps it', () => {
  let f = field()
  f.type('q', '.tas')
  assertEquals(f.press('q', 'Enter'), true)
  assertEquals(f.text('q'), '.task')
  assertEquals(f.press('q', 'Enter'), false, 'the host sends it as typed')
  assertEquals(f.text('q'), '.task')
  assertEquals(f.row('q')?.cands, [])
  f.type('q', '.task')
  f.press('q', 'Tab')
  assertEquals(f.text('q'), '.task.', 'Tab reads on')
})

test('a closed list leaves every key to its host', () => {
  let f = field()
  f.type('q', '.task .st')
  assertEquals(f.press('q', 'Escape'), true)
  assertEquals(f.row('q')?.cands, [])
  for (let key of ['Escape', 'Enter', 'Tab', 'ArrowUp']) {
    assertEquals(f.press('q', key), false, key)
  }
  f.set('q', '.task .st')
  assertEquals(f.press('q', 'Tab'), false, 'a host-put line offers nothing')
})

test('a source that answers later lands its list unless typing moved on', async () => {
  let asked: ((c: Cand[]) => void)[] = []
  let source: Source = {
    ids: () => new Promise<Cand[]>((done) => asked.push(done)),
  }
  let f = field({ source })
  f.type('q', '.owner=T')
  assertEquals(f.text('q'), '.owner=T')
  f.type('q', '.owner=T-')
  asked[0]([{ text: 'T-1', kind: 'task' }]) // stale: typed past it
  asked[1]([{ text: 'T-12', kind: 'task' }])
  await settle()
  assertEquals(words(f.row('q')?.cands), ['.owner=T-12'])
})

// A page: the field mounted in a document, typed into through its element.
let page = (
  f: ReturnType<typeof field>,
  props: Record<string, unknown> = {},
) => {
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let { document, window } = parseHTML('<main></main>')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  // linkedom keeps no selection; a caret is all a field reads of one.
  Object.assign(window.HTMLInputElement.prototype, {
    setSelectionRange(this: { selectionStart: number }, at: number) {
      this.selectionStart = at
    },
  })
  let root = document.querySelector('main')!
  render(h(f.Filter, { id: 'q', ...props }), root)
  let input = root.querySelector('input')!
  let typeIn = (text: string) => {
    input.value = text
    input.setSelectionRange(text.length, text.length)
    input.dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  let key = (k: string) => {
    // linkedom has no KeyboardEvent; a keydown is an event with its key.
    let e = Object.assign(
      new window.Event('keydown', { bubbles: true, cancelable: true }),
      { key: k },
    )
    input.dispatchEvent(e)
    return e.defaultPrevented
  }
  let rows = () =>
    [...root.querySelectorAll('.Choices_Item')].map((n) => n.textContent)
  let free = () => {
    render(null, root)
    if (prior) Object.defineProperty(globalThis, 'document', prior)
    else delete (globalThis as { document?: unknown }).document
  }
  return { root, input, typeIn, key, rows, free }
}

test('in a page, the element types, the list paints, and a taken word lands at the caret', async () => {
  let f = field()
  let hosted: string[] = []
  let p = page(f, {
    initial: '.task',
    onKey: (e: KeyboardEvent) => hosted.push(e.key),
  })
  try {
    await settle()
    assertEquals(p.input.value, '.task')
    p.typeIn('.task .sta')
    await settle()
    assertEquals(p.rows(), ['.statustask'])
    assert(p.key('Tab'))
    await settle()
    assertEquals(p.input.value, '.task .status')
    assertEquals(p.input.selectionStart, '.task .status'.length)
    assertEquals(p.key('Escape'), true)
    await settle()
    assertEquals(p.rows(), [])
    p.key('Escape')
    assertEquals(hosted, ['Escape'])
  } finally {
    p.free()
  }
})

test('in a terminal, the field paints its caret and its list under it', () => {
  let f = field()
  f.type('q', '.task .st')
  let painted = print(h(f.Filter, { id: 'q', active: true }), 40)
  assert(painted.includes('.task .st\x1b[7m \x1b[0m'), 'the caret is a cell')
  assertEquals(painted.replace(STYLE, '').split('\n'), [
    '.task .st ',
    '.statustask',
  ])
})
