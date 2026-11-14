/** A conversation follows its newest line until its reader scrolls up, and
 * draws the lines it is given, older ones when asked: on a linkedom page
 * whose pane scrolls as a browser's does, clamped to its content. */
import { equal, test } from '@yaks/testing'
import { client } from '@yaks/client'
import type { Bundle } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { h, hydrate, render } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import {
  Conversation,
  conversationAt,
  conversed,
  conversingOf,
  Disclosure,
  DisclosureMark,
  Fold,
  type Line,
  scrolled,
  shown,
  stopped,
  TAKE,
  useFold,
} from './Conversation.ts'
import { signal } from '@preact/signals'
import { docs } from './vocab.ts'

let lines = (n: number, from = 0): Line[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `l${from + i}`,
    node: h('p', {}, `line ${from + i}`),
  }))

// A page with its pane, the conversation in it held in a page graph; `grow`
// is the browser telling it its content changed size.
let page = (hash = '') => {
  let { document, window, Event } = parseHTML(
    '<html><body><main id="pane"><div id="talk"></div></main>' +
      '<nav id="menu"></nav></body></html>',
  )
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let grew: (() => void)[] = []
  // The page's window is its own: what is set on linkedom's is set on
  // globalThis, for every file after this one.
  let win = Object.assign(new EventTarget(), {
    location: { hash },
    ResizeObserver: class {
      constructor(fn: () => void) {
        grew.push(fn)
      }
      observe() {}
      disconnect() {}
    },
  })
  Object.defineProperty(document, 'defaultView', { value: win })
  let pane = document.getElementById('pane') as HTMLElement
  // Each line is 100px high, and what grows besides them (a picture
  // loading) adds to it.
  let rows = () => [...pane.querySelectorAll('[id^=row-]')]
  let grown = 2700, y = 0
  let height = () => grown + rows().length * 100
  Object.defineProperties(pane, {
    clientHeight: { get: () => 800 },
    scrollHeight: { get: height },
    scrollTop: {
      get: () => y,
      set: (v: number) => y = Math.max(0, Math.min(v, height() - 800)),
    },
  })
  let element = (window as unknown as { HTMLElement: typeof HTMLElement })
    .HTMLElement.prototype
  let into = Object.getOwnPropertyDescriptor(element, 'scrollIntoView')
  element.scrollIntoView = () => void (pane.scrollTop = 1000)
  let front = client(loadVocab(docs), [], { vault: false, wireVault: false })
  let at = conversationAt('page', 'session')
  let root = document.getElementById('talk')!
  let given = lines(3)
  let draw = (more: Line[] = given) => {
    given = more
    render(
      h(Conversation, {
        e: front.ent(at) ?? { entity: { eid: at } },
        onChange: (b: Bundle) => {
          front.mutate([b])
          draw()
        },
        lines: given,
        now: 'Working',
        pane: () => pane,
      }),
      root,
    )
  }
  draw()
  return {
    root,
    pane,
    state: () => ({ away: false, ...conversingOf(front.ent(at)) }),
    // its owner's Newest
    back: () => {
      front.mutate([conversed(front.ent(at) ?? { entity: { eid: at } }, {
        away: false,
      })])
      draw()
    },
    draw,
    scroll: (to: number) => {
      pane.scrollTop = to
      pane.dispatchEvent(new Event('scroll'))
    },
    press: (at: Element) => at.dispatchEvent(new Event('click')),
    grow: (by: number) => (grown += by, grew.forEach((f) => f())),
    newest: () => pane.scrollTop == height() - 800,
    rows: () => rows().map((r) => r.id),
    [Symbol.dispose]: () => {
      render(null, root)
      front.close()
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else Reflect.deleteProperty(globalThis, 'document')
      if (into) Object.defineProperty(element, 'scrollIntoView', into)
      else Reflect.deleteProperty(element, 'scrollIntoView')
    },
  }
}

test('a reader is away once they scroll up, and back once they reach the newest', () => {
  equal(scrolled(false, { was: 900, now: 500, near: false }), true)
  equal(scrolled(true, { was: 500, now: 900, near: false }), true)
  equal(scrolled(true, { was: 500, now: 2100, near: true }), false)
  equal(scrolled(false, { was: 500, now: 900, near: false }), false)
})

test('it draws the last lines it takes and counts the earlier ones', () => {
  let some = lines(5)
  equal(shown(some, 2).lines.map((l) => l.id), ['l3', 'l4'])
  equal(shown(some, 2, 7).hidden, 10)
  equal(shown(some).hidden, 0)
})

test('it stays at the newest as lines arrive, until the reader scrolls up', () => {
  using p = page()
  equal([p.newest(), p.state().away], [true, false])
  p.grow(400)
  p.draw(lines(4))
  equal(p.newest(), true)
  p.scroll(900)
  equal(p.state().away, true)
  p.grow(600)
  p.draw(lines(5))
  equal(p.pane.scrollTop, 900)
  p.scroll(p.pane.scrollHeight)
  equal(p.state().away, false)
  p.grow(300)
  equal(p.newest(), true)
})

test('told it is back at the newest, it goes there', () => {
  using p = page()
  p.scroll(500)
  p.grow(500)
  equal(p.pane.scrollTop, 500)
  p.back()
  equal([p.newest(), p.state().away], [true, false])
})

test('scrolling under a layer over it is not the reader', () => {
  using p = page('#menu')
  p.scroll(0)
  equal(p.state().away, false)
})

test('an address naming a line opens at it, away from the newest', () => {
  using p = page('#row-l1')
  equal(p.state().away, true)
})

test('it draws the last hundred lines, and earlier ones above when asked, where the reader is', () => {
  using p = page()
  p.draw(lines(TAKE + 5))
  equal(p.rows().length, TAKE)
  let more = p.root.querySelector('button')!
  equal(more.textContent, 'Show 5 earlier')
  p.scroll(400)
  let below = p.pane.scrollHeight - p.pane.scrollTop
  p.press(more)
  equal(p.rows().length, TAKE + 5)
  equal(p.rows()[0], 'row-l0')
  equal(p.state(), { away: true, take: 2 * TAKE })
  equal(p.pane.scrollHeight - p.pane.scrollTop, below)
  equal(p.root.querySelector('button'), null)
})

// A line's words with a mark beside them opening the fold under them, which
// holds a fold of its own, as a call's turn is drawn.
let Marked = ({ said }: { said: string }) => {
  let fold = useFold()
  return h(
    'div',
    {},
    h(DisclosureMark, fold, '☎'),
    h(
      Disclosure,
      { ...fold, summary: said },
      h(Fold, { summary: 'inner' }, 'x'),
    ),
  )
}

// A conversation drawn by a server and mounted over on a page whose graph
// holds its state. Its line `a` has two folds, the second inside the first,
// and a mark opening the first;
// `draw` draws it again saying `said`, or as the server drew it (`null`),
// then `more` lines after it, as its owner draws it again on each change.
let served = () => {
  let held = new Map<string, Bundle>()
  let line = (said: string | null): Line =>
    said == null
      ? { id: 'a', html: kept }
      : { id: 'a', node: h(Marked, { said }) }
  let last: [string | null, number] = ['Reading…', 0]
  let props = (said: string | null, more: number) => ({
    e: { entity: { eid: conversationAt('page', 's') } },
    onChange: (b: Bundle) => (held.set(b.entity.eid, b), draw(...last)),
    state: (eid: string) => held.get(eid),
    lines: [line(said), ...lines(more)],
  })
  let kept = ''
  let html = renderToString(h(Conversation, props('Reading…', 0)))
  let { document, Event } = parseHTML(
    `<html><body><main>${html}</main></body></html>`,
  )
  let main = document.querySelector('main')!
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  kept = main.querySelector('#row-a')!.innerHTML
  let draw = (said: string | null, more = 0) => (
    last = [said, more], render(h(Conversation, props(said, more)), main)
  )
  hydrate(h(Conversation, props(null, 0)), main)
  return {
    main,
    html,
    draw,
    folds: () =>
      [...main.querySelectorAll('details')].map((d) => d.hasAttribute('open')),
    // as a browser opens a details by itself and tells it, seen on its way
    // down to the fold
    toggle: (at: number) => {
      let fold = main.querySelectorAll('details')[at]
      fold.toggleAttribute('open')
      fold.dispatchEvent(new Event('toggle', { bubbles: true }))
    },
    press: (at: number) =>
      (main.querySelectorAll('summary')[at] as HTMLElement).click(),
    mark: () => main.querySelector('[data-disclosure-mark]')!,
    [Symbol.dispose]: () => {
      render(null, main)
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else Reflect.deleteProperty(globalThis, 'document')
    },
  }
}

test('it mounts over the page a server drew, whose folds are closed details that open with no script', () => {
  using p = served()
  equal(p.main.innerHTML, p.html)
  equal(p.folds(), [false, false])
  equal(p.main.querySelectorAll('details .More_Body').length, 2)
})

test('a fold opened on the line the server drew stays open as its line is drawn again in other words', () => {
  using p = served()
  p.toggle(1)
  p.draw('Read', 1)
  equal(p.main.querySelector('summary')!.textContent, 'Read')
  equal(p.folds(), [false, true])
  p.draw(null, 1)
  equal(p.folds(), [false, true], 'and as the server drew it')
})

test('a fold pressed open stays open as its line is drawn again, and closes when pressed', () => {
  using p = served()
  p.draw('Reading…')
  p.press(0)
  equal(p.folds(), [true, false])
  p.draw('Read', 2)
  equal(p.folds(), [true, false])
  p.press(0)
  equal(p.folds(), [false, false])
})

test("a mark opens and closes its fold, on the server's line as on one drawn again", () => {
  using p = served()
  let pressed = () => (p.mark() as HTMLElement).click()
  pressed()
  equal(p.folds(), [true, false])
  equal(p.mark().getAttribute('aria-expanded'), 'true')
  p.draw('Read')
  equal(p.folds(), [true, false])
  pressed()
  equal(p.folds(), [false, false])
  equal(p.mark().getAttribute('aria-expanded'), 'false')
})

// A box on a linkedom page, its words kept in drafts held in a signal, as a
// host's are, and what it emits kept.
let boxed = () => {
  let { document, Event } = parseHTML(
    '<html><body><div id="box"></div></body></html>',
  )
  let prior = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
  })
  let texts = signal<Record<string, string>>({})
  let drafts = {
    text: (place: string) => texts.value[place] ?? '',
    type: (place: string, text: string) =>
      void (texts.value = { ...texts.value, [place]: text }),
    spend: (place: string) =>
      void (texts.value = { ...texts.value, [place]: '' }),
  }
  let sent: Bundle[] = [], stops: Bundle[] = []
  let root = document.getElementById('box')!
  let draw = (more: Record<string, unknown> = {}) =>
    render(
      h(Conversation.Box, {
        place: 'talk',
        drafts,
        session: 's1',
        words: (body) => ({ entity: { eid: 'said' }, content: { body } }),
        onSend: (b) => void sent.push(b),
        onStop: (b) => void stops.push(b),
        name: 'say',
        ...more,
      }),
      root,
    )
  draw()
  let field = () => root.querySelector('textarea') as HTMLTextAreaElement
  return {
    drafts,
    sent,
    stops,
    draw,
    field,
    root,
    type: (text: string) => {
      field().value = text
      field().dispatchEvent(new Event('input'))
    },
    key: (key: string, shiftKey = false) =>
      field().dispatchEvent(
        Object.assign(new Event('keydown', { cancelable: true }), {
          key,
          shiftKey,
        }),
      ),
    [Symbol.dispose]: () => {
      render(null, root)
      if (prior) Object.defineProperty(globalThis, 'document', prior)
      else Reflect.deleteProperty(globalThis, 'document')
    },
  }
}

test('words typed in the box are its draft, and Enter sends them, the draft kept until it is spent', () => {
  using b = boxed()
  b.type('Find the recipe')
  equal(b.drafts.text('talk'), 'Find the recipe')
  b.key('Enter', true)
  equal(b.sent, [])
  b.key('Enter')
  equal(b.sent, [{
    entity: { eid: 'said' },
    content: { body: 'Find the recipe' },
  }])
  equal(b.field().value, 'Find the recipe')
  b.drafts.spend('talk')
  b.draw()
  equal(b.field().value, '')
})

test('a draft typed elsewhere shows in the box', () => {
  using b = boxed()
  b.drafts.type('talk', 'From the phone')
  b.draw()
  equal(b.field().value, 'From the phone')
})

test('a box sending waits, and Stop says so on its conversation', () => {
  using b = boxed()
  b.draw({ sending: true, busy: true, said: 'Sending…' })
  b.key('Enter')
  equal(b.sent, [])
  equal(b.root.querySelector('.Composer')!.hasAttribute('data-busy'), true)
  equal(b.root.querySelector('.Composer_Status')!.textContent, 'Sending…')
  ;(b.root.querySelector('.Composer_Stop') as HTMLElement).click()
  equal(b.stops, [{ entity: { eid: 's1' }, Stop: {} }])
  equal(stopped('s1'), b.stops[0])
})
