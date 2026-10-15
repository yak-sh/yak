import { test } from '@yaks/testing'
import { signal } from '@preact/signals'
import { assert, assertEquals } from '@std/assert'
import { client } from '@yaks/client'
import { desk, draftDoc, type Drafts, drafts } from '@yaks/draft'
import { type Bundle, type Comp, mint } from '@yaks/graph'
import { type Cand, type Source } from '@yaks/query'
import { print } from '@yaks/tui/print'
import { loadVocab } from '@yaks/vocab'
import { parseHTML } from 'linkedom'
import { h, render } from 'preact'
import { filters, type Front, type Opts } from './mod.ts'
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
let draftVocab = loadVocab([draftDoc])
let pageVocab = loadVocab(docs)
// A person's drafts, kept in a graph of their own: every page given the same
// ones is another interface they type in.
let kept = (): Drafts => {
  let store = client(draftVocab, [drafts()], { vault: false })
  let by = mint()
  return desk(store, { by: () => by })
}
// A field in a page of its own.
let field = (opts: Partial<Opts> = {}, typed = kept()) =>
  filters(client(pageVocab, [], { vault: false }), {
    vocab,
    drafts: typed,
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
  // A property's name offers it with its component.
  f.type('q', '.st')
  assertEquals(words(f.row('q')?.cands), ['.task.status'])
  assertEquals(f.press('q', 'Tab'), true)
  // Taking a property rolls on to what may follow it.
  assertEquals(f.text('q'), '.task.status')
  assertEquals(words(f.row('q')?.cands).slice(0, 2), [
    '.task.status=',
    '.task.status!=',
  ])
  f.press('q', 'Tab')
  assertEquals(words(f.row('q')?.cands), [
    '.task.status=open',
    '.task.status=done',
  ])
  f.press('q', 'ArrowDown')
  f.press('q', 'ArrowDown') // held to the list
  f.press('q', 'Enter')
  assertEquals(f.row('q')?.caret, '.task.status=done'.length)
  assertEquals(f.text('q'), '.task.status=done')
})

let typed = kept()
field({}, typed).type('q', '.task .st')
test('what is typed is the draft: another page shows it, and not its list', () => {
  let next = field({}, typed)
  assertEquals(next.text('q'), '.task .st')
  assertEquals(next.row('q')?.cands, [])
})

// Key and paint behavior uses the controller's reactive host contracts.
let local = () => {
  let text = signal<Record<string, string>>({})
  let rows = signal<Bundle[]>([])
  let front: Front = {
    ent: (id) => rows.value.find((b) => b.entity.eid == id),
    watch: (query) => {
      assertEquals(query, '.filter')
      return {
        get value() {
          return rows.value
        },
        subscribe: (fn) => rows.subscribe(fn),
      }
    },
    mutate: (bundles) => {
      let next = new Map(rows.value.map((b) => [b.entity.eid, b]))
      for (let patch of bundles) {
        let prior = next.get(patch.entity.eid)
        next.set(patch.entity.eid, {
          entity: patch.entity,
          filter: { ...prior?.filter as Comp, ...patch.filter as Comp },
        })
      }
      rows.value = [...next.values()]
    },
  }
  return filters(front, {
    vocab,
    drafts: {
      text: (id) => text.value[id] ?? '',
      type: (id, value) => text.value = { ...text.value, [id]: value },
    },
  })
}
let entering = local()
test('Enter takes a word to where it reads whole, then keeps it', () => {
  let f = entering
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

let closing = field()
closing.type('q', '.task .st')
test('a closed list leaves every key to its host', () => {
  assertEquals(closing.press('q', 'Escape'), true)
  assertEquals(closing.row('q')?.cands, [])
  for (let key of ['Escape', 'Enter', 'Tab', 'ArrowUp']) {
    assertEquals(closing.press('q', key), false, key)
  }
})

let hosted = field()
test('a host-put line offers nothing', () => {
  hosted.set('q', '.task .st')
  assertEquals(hosted.press('q', 'Tab'), false)
})

test('a source that answers later lands its list unless typing moved on', async () => {
  let asked: ((c: Cand[]) => void)[] = []
  let source: Source = {
    ids: () => new Promise<Cand[]>((done) => asked.push(done)),
  }
  let f = field({ source })
  f.type('q', '.task.owner=T')
  assertEquals(f.text('q'), '.task.owner=T')
  f.type('q', '.task.owner=T-')
  asked[0]([{ text: 'T-1', kind: 'task' }]) // stale: typed past it
  asked[1]([{ text: 'T-12', kind: 'task' }])
  await settle()
  assertEquals(words(f.row('q')?.cands), ['.task.owner=T-12'])
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
    p.typeIn('.sta')
    await settle()
    assertEquals(p.rows(), ['.task.statustask'])
    assert(p.key('Tab'))
    await settle()
    assertEquals(p.input.value, '.task.status')
    assertEquals(p.input.selectionStart, '.task.status'.length)
    assertEquals(p.key('Escape'), true)
    await settle()
    assertEquals(p.rows(), [])
    p.key('Escape')
    assertEquals(hosted, ['Escape'])
  } finally {
    p.free()
  }
})

let terminal = local()
terminal.type('q', '.st')
// Paint the fixed terminal field once, then read its caret and complete list.
let painted = print(h(terminal.Filter, { id: 'q', active: true }), 40)
terminal.dispose()
test('in a terminal, the field paints its caret and its list under it', () => {
  assert(painted.includes('.st\x1b[7m \x1b[0m'), 'the caret is a cell')
  assertEquals(painted.replace(STYLE, '').split('\n'), [
    '.st ',
    '.task.statustask',
  ])
})
