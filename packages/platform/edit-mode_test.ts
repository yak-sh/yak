// Edit mode on an app's page (edit-mode.ts), in a linkedom page with the
// person's real draft desk over a store that answers at once: no network, no
// browser.
import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { browserDrafts } from '@yaks/draft/browser'
import type { Bundle } from '@yaks/graph'
import { editMode, hint, listOf, placeOf, SAVED } from './edit-mode.ts'

let BODY = `
<h1 data-copy="hero.title">Build your ideas</h1>
<p data-copy="cost.limits">Tax is included. <a href="/pricing" data-copy-slot="plans" data-copy="cost.plans">Compare plans</a>.</p>
<button data-copy="cta">Start</button>
<footer><span data-copy="hero.title">Build your ideas</span></footer>`

// What the app's save door answers, by path, and what it was sent. An answer
// given as a promise arrives when the test settles it.
type Answer = { status: number; body: unknown }
let OK = (body: unknown): Answer => ({ status: 200, body })
let REPORT = 'https://ada.yaks.app/cookbook/_web/assets/interaction'
let later = () => {
  let answer!: (a: Answer) => void
  let held = new Promise<Answer>((go) => answer = go)
  return { held, answer }
}

let load = async (
  body = BODY,
  answers: Record<string, Answer | Promise<Answer>> = {},
) => {
  let win = parseHTML(
    `<html><head></head><body>${body}</body></html>`,
  ) as unknown as Window & typeof globalThis
  let doc = win.document
  // linkedom's window is a Proxy over globalThis, so the page's address is
  // given on a window of this document's own, never on the process's global.
  let at = new URL('https://ada.yaks.app/cookbook/about')
  Object.defineProperty(doc, 'defaultView', {
    value: new Proxy(win, {
      get: (w, name) => name == 'location' ? at : Reflect.get(w, name),
    }),
  })
  let applied: Bundle[] = []
  let hear: (rows: Bundle[]) => void = () => {}
  // Each write counts one more rev, as the store's hook does.
  let rev = 0
  let drafts = browserDrafts(
    {
      me: () => Promise.resolve({ person: 'jo' }),
      apply: (bundles) => {
        applied.push(...bundles)
        return Promise.resolve({
          bundles: bundles.map((b) => ({
            ...b,
            draft: { ...b.draft as object, rev: ++rev },
          })),
        })
      },
      subscribe: (_query, fn) => {
        hear = fn
        return () => {}
      },
    },
    'cookbook',
    { by: 'jo', stash: false, pace: 0 },
  )
  let panel = doc.createElement('div')
  let done = 0
  let sent: { url: string; body: unknown }[] = []
  let timed: { points: { page: string; target: string; ms: number }[] }[] = []
  let mode = editMode(doc, drafts, {
    panel,
    at: '/cookbook/',
    fetch: async (url, init) => {
      let body = JSON.parse(String(init?.body))
      if (String(url) == REPORT) {
        timed.push(body)
        return new Response(null, { status: 204 })
      }
      sent.push({ url: String(url), body })
      let path = String(url).split('/api/')[1]
      let answer = await (answers[path] ?? { status: 404, body: null })
      return Response.json(answer.body, { status: answer.status })
    },
    ask: 'https://yaks.app/manage/ada?app=cookbook',
    report: REPORT,
    done: () => done++,
  })
  await drafts.ready
  await Promise.resolve()
  let q = (css: string) => doc.querySelector(css)!
  let press = (el: Element, type = 'click') => {
    let e = new win.Event(type, { bubbles: true, cancelable: true })
    el.dispatchEvent(e)
    return e
  }
  let typeInto = (el: Element, text: string) => {
    el.firstChild!.textContent = text
    press(el, 'input')
  }
  let says = () => panel.textContent
  let shown = () =>
    [...panel.children].filter((el) => !(el as HTMLElement).hidden)
      .map((el) => el.textContent).join(' · ')
  let button = (name: string) =>
    panel.querySelector(`[data-${name}]`) as HTMLButtonElement
  let settled = () => new Promise((go) => setTimeout(go, 0))
  return {
    shown,
    button,
    settled,
    sent,
    timed,
    doc,
    q,
    press,
    typeInto,
    says,
    panel,
    drafts,
    applied,
    mode,
    heard: (place: string, text: string) =>
      hear([{
        entity: { eid: place },
        draft: { by: 'jo', place, text, rev: ++rev },
      }]),
    done: () => done,
  }
}

test('edit mode outlines the page, and Done takes the outlines off', async () => {
  let p = await load()
  ok(p.doc.documentElement.hasAttribute('data-yak-editing'))
  equal(p.shown(), 'Click any outlined words to change them. ·  · Done')
  p.mode.stop()
  ok(!p.doc.documentElement.hasAttribute('data-yak-editing'))
  equal(p.says(), '')
})

test('the hint says Tap on a touch screen and Click with a mouse', () => {
  let at = (coarse: boolean) =>
    ({
      matchMedia: (q: string) => ({
        matches: coarse && q == '(pointer: coarse)',
      }),
    }) as unknown as Window
  equal(hint(at(true)), 'Tap any outlined words to change them.')
  equal(hint(at(false)), 'Click any outlined words to change them.')
})

test('a press lets the person type over a snippet, kept as their draft at copy:<key>', async () => {
  let p = await load()
  let h1 = p.q('h1')
  p.press(h1, 'pointerdown')
  equal(h1.getAttribute('contenteditable'), 'plaintext-only')
  p.typeInto(h1, 'Build it by asking')
  equal(p.drafts.text(placeOf('hero.title')), 'Build it by asking')
  // The same snippet elsewhere on the page shows it too.
  equal(p.q('footer span').textContent, 'Build it by asking')
  ok(h1.hasAttribute('data-yak-changed'))
  equal(p.shown(), '1 change · Save · Discard ·  · Done')
  p.mode.stop()
})

test("a slot's child is not typed over, and holds its place in the snippet", async () => {
  let p = await load()
  let para = p.q('p'), link = p.q('a')
  p.press(para, 'pointerdown')
  equal(link.getAttribute('contenteditable'), 'false')
  p.typeInto(para, 'Tax is always included. ')
  equal(
    p.drafts.text(placeOf('cost.limits')),
    'Tax is always included. %{plans}.',
  )
  equal(link.textContent, 'Compare plans')
  // The link's own words are a snippet of their own.
  p.press(link, 'pointerdown')
  equal(para.hasAttribute('contenteditable'), false)
  equal(link.hasAttribute('contenteditable'), true)
  p.mode.stop()
})

test('links and buttons do not act while editing', async () => {
  let p = await load()
  // The app's own handler. linkedom calls a target's listeners before the
  // window's capturing ones, as no browser does, so it listens on the window,
  // after edit mode's, where linkedom's order is a browser's.
  let heard = 0
  p.doc.defaultView!.addEventListener('click', () => heard++)
  for (let el of [p.q('a'), p.q('button')]) ok(p.press(el).defaultPrevented)
  equal(heard, 0)
  p.mode.stop()
  ok(!p.press(p.q('a')).defaultPrevented)
  equal(heard, 1)
})

test('a draft typed on another device shows in place, and Discard empties every one', async () => {
  let p = await load()
  p.heard(placeOf('cta'), 'Start cooking')
  p.heard(placeOf('cost.plans'), 'See the plans')
  equal(p.q('button').textContent, 'Start cooking')
  equal(p.q('a').textContent, 'See the plans')
  equal(p.shown(), '2 changes · Save · Discard ·  · Done')
  p.press(p.panel.querySelector('[data-discard]')!)
  await new Promise((go) => setTimeout(go, 0))
  equal(p.q('button').textContent, 'Start')
  equal(
    p.applied.map((b) => (b.draft as { text: string }).text),
    ['', ''],
  )
  equal(p.shown(), 'Click any outlined words to change them. ·  · Done')
  p.mode.stop()
})

test("typed back to the page's own words, a snippet is no change", async () => {
  let p = await load()
  let h1 = p.q('h1')
  p.press(h1, 'pointerdown')
  p.typeInto(h1, 'Something else')
  p.typeInto(h1, 'Build your ideas')
  p.press(p.q('button'), 'pointerdown')
  await new Promise((go) => setTimeout(go, 0))
  equal(p.drafts.places(), [])
  p.mode.stop()
})

test('off, the page shows its own words again and the drafts stay', async () => {
  let p = await load()
  p.heard(placeOf('cta'), 'Start cooking')
  p.mode.stop()
  equal(p.q('button').textContent, 'Start')
  equal(p.drafts.text(placeOf('cta')), 'Start cooking')
})

test('a page with nothing marked says so and offers the Operator, the ask typed', async () => {
  let p = await load('<h1>Hello</h1>')
  let link = p.panel.querySelector('a')!
  equal(
    p.panel.querySelector('p')!.textContent,
    'Nothing on this page is editable yet.',
  )
  let to = new URL(link.getAttribute('href')!)
  equal(to.origin + to.pathname, 'https://yaks.app/manage/ada')
  equal(to.searchParams.get('app'), 'cookbook')
  ok(
    to.searchParams.get('say')!.includes('https://ada.yaks.app/cookbook/about'),
  )
  p.mode.stop()
})

test('Save sends the drafts, and the page then shows the saved words as its own', async () => {
  let p = await load(BODY, { save: OK({ version: 4, keys: ['hero.title'] }) })
  p.heard(placeOf('hero.title'), 'Build it by asking')
  p.press(p.button('save'))
  await p.settled()
  equal(p.sent, [{
    url: 'https://ada.yaks.app/cookbook/api/save',
    body: { copy: { 'hero.title': 'Build it by asking' } },
  }])
  equal(p.drafts.places(), [])
  equal(p.q('h1').textContent, 'Build it by asking')
  equal(
    p.shown(),
    'Click any outlined words to change them. · Saved as version 4 · Undo · Done',
  )
  p.mode.stop()
  equal(p.q('footer span').textContent, 'Build it by asking')
})

test('Save shows the words saved at once, and spends the drafts only once it answers', async () => {
  let { held, answer } = later()
  let p = await load(BODY, { save: held })
  p.heard(placeOf('hero.title'), 'Build it by asking')
  p.press(p.button('save'))
  equal(p.q('h1').textContent, 'Build it by asking')
  ok(!p.q('h1').hasAttribute('data-yak-changed'))
  equal(
    p.shown(),
    `Click any outlined words to change them. · ${SAVED} · Done`,
  )
  equal(p.drafts.text(placeOf('hero.title')), 'Build it by asking')
  answer(OK({ version: 4, keys: ['hero.title'] }))
  await p.settled()
  equal(p.drafts.places(), [])
  equal(
    p.shown(),
    'Click any outlined words to change them. · Saved as version 4 · Undo · Done',
  )
  equal(
    p.timed.map((t) => t.points.map(({ page, target }) => [page, target])),
    [[['app', 'saved']]],
  )
  p.mode.stop()
})

test('a save that fails after showing puts the page back, keeps the draft, and says why', async () => {
  let { held, answer } = later()
  let p = await load(BODY, { save: held })
  p.heard(placeOf('cta'), 'Start cooking')
  p.press(p.button('save'))
  equal(p.q('button').textContent, 'Start cooking')
  // Pressed into and left while on its way, the draft stays.
  p.press(p.q('button'), 'pointerdown')
  p.press(p.q('h1'), 'pointerdown')
  answer({ status: 503, body: { error: { message: 'the app is busy' } } })
  await p.settled()
  equal(p.drafts.text(placeOf('cta')), 'Start cooking')
  ok(p.q('button').hasAttribute('data-yak-changed'))
  equal(
    p.shown(),
    '1 change · Save · Discard · Not saved: the app is busy. ' +
      'Your changes are kept. · Done',
  )
  equal(p.timed.map((t) => t.points[0].target), ['saved'])
  p.mode.stop()
  equal(p.q('button').textContent, 'Start')
})

test('a Save pressed while one is on its way goes after it', async () => {
  let first = later()
  let p = await load(BODY, { save: first.held })
  p.heard(placeOf('cta'), 'Start cooking')
  p.press(p.button('save'))
  p.heard(placeOf('hero.title'), 'Build it by asking')
  p.press(p.button('save'))
  await p.settled()
  equal(p.sent.length, 1)
  first.answer(OK({ version: 4, keys: ['cta'] }))
  await p.settled()
  equal(p.sent.map((s) => s.body), [
    { copy: { cta: 'Start cooking' } },
    { copy: { 'hero.title': 'Build it by asking' } },
  ])
  p.mode.stop()
})

test('Undo after a queued save returns to the last confirmed words', async () => {
  let first = later()
  let answers: Record<string, Answer | Promise<Answer>> = {
    save: first.held,
    'save/undo': OK({ version: 3 }),
  }
  let p = await load(BODY, answers)
  let place = placeOf('cta')
  p.heard(place, 'Start cooking')
  p.press(p.button('save'))
  await p.settled()
  p.heard(place, 'Start baking')
  p.press(p.button('save'))
  answers.save = OK({ version: 4, keys: ['cta'] })
  first.answer({ status: 503, body: null })
  await p.settled()
  equal(p.q('button').textContent, 'Start baking')
  p.press(p.button('undo'))
  await p.settled()
  equal(p.drafts.text(place), 'Start baking')
  await p.mode.stop()
  equal(p.q('button').textContent, 'Start')
})

test('a save that fails after Done restores the page and keeps the draft', async () => {
  let { held, answer } = later()
  let p = await load(BODY, { save: held })
  let place = placeOf('cta')
  p.heard(place, 'Start cooking')
  p.press(p.button('save'))
  let stopped = p.mode.stop()
  equal(p.q('button').textContent, 'Start cooking')
  answer({ status: 503, body: { error: { message: 'the app is busy' } } })
  await stopped
  equal(p.q('button').textContent, 'Start')
  equal(p.drafts.text(place), 'Start cooking')
  equal(p.shown(), 'Not saved: the app is busy. Your changes are kept.')
})

test('a refused save keeps every draft, and says why', async () => {
  let p = await load(BODY, {
    save: {
      status: 400,
      body: { error: { message: 'copy.json is not JSON' } },
    },
  })
  p.heard(placeOf('cta'), 'Start cooking')
  p.press(p.button('save'))
  await p.settled()
  equal(p.drafts.text(placeOf('cta')), 'Start cooking')
  equal(
    p.shown(),
    '1 change · Save · Discard · Not saved: copy.json is not JSON. ' +
      'Your changes are kept. · Done',
  )
  p.mode.stop()
})

test('Undo takes the save back, and its changes are drafts again', async () => {
  let p = await load(BODY, {
    save: OK({ version: 4, keys: ['cta'] }),
    'save/undo': OK({ version: 3 }),
  })
  p.heard(placeOf('cta'), 'Start cooking')
  p.press(p.button('save'))
  await p.settled()
  p.press(p.button('undo'))
  await p.settled()
  equal(p.sent[1].body, { version: 4 })
  equal(p.drafts.text(placeOf('cta')), 'Start cooking')
  equal(
    p.shown(),
    '1 change · Save · Discard · Version 4 is taken back. ' +
      'Your changes are drafts again. · Done',
  )
  p.mode.stop()
  equal(p.q('button').textContent, 'Start')
})

let LIST = `
<ul class="Plan_List" data-copy-list="always"><li class="Plan_Item">Members</li><li class="Plan_Item">Visitors</li></ul>
<h1 data-copy="hero.title">Build your ideas</h1>`
let ALWAYS = placeOf('always', true)

// A list page, a key pressed in an item, and the items' words.
let listed = async (answers: Record<string, Answer> = {}) => {
  let p = await load(LIST, answers)
  let win = p.doc.defaultView!
  let key = (el: Element, key: string, more: Record<string, unknown> = {}) => {
    let e = Object.assign(
      new win.Event('keydown', { bubbles: true, cancelable: true }),
      { key, ...more },
    )
    el.dispatchEvent(e)
    return e
  }
  let items = () => [...p.doc.querySelectorAll('li')]
  let words = () => items().map((li) => li.textContent)
  let type = (el: Element, text: string) => {
    el.textContent = text
    p.press(el, 'input')
  }
  return { ...p, key, items, words, type }
}

test('an item is typed over in place, and the draft is the whole list', async () => {
  let p = await listed()
  let [members] = p.items()
  p.press(members, 'pointerdown')
  equal(members.getAttribute('contenteditable'), 'plaintext-only')
  p.type(members, 'Members, as many as you like')
  equal(p.drafts.text(ALWAYS), '["Members, as many as you like","Visitors"]')
  ok(p.q('ul').hasAttribute('data-yak-changed'))
  equal(p.shown(), '1 change · Save · Discard ·  · Done')
  p.mode.stop()
})

test('Enter adds an item after it, with the same markup, and Backspace in it empty removes it', async () => {
  let p = await listed()
  let [members] = p.items()
  p.press(members, 'pointerdown')
  ok(p.key(members, 'Enter').defaultPrevented)
  let added = p.items()[1]
  equal([added.tagName, added.className, added.textContent], [
    'LI',
    'Plan_Item',
    '',
  ])
  p.type(added, 'Guests')
  equal(p.words(), ['Members', 'Guests', 'Visitors'])
  equal(listOf(p.drafts.text(ALWAYS)), ['Members', 'Guests', 'Visitors'])
  p.type(added, '')
  ok(p.key(added, 'Backspace').defaultPrevented)
  equal(p.words(), ['Members', 'Visitors'])
  equal(members.getAttribute('contenteditable'), 'plaintext-only')
  // Back to the page's own items, the list is no change.
  p.press(p.q('h1'), 'pointerdown')
  await p.settled()
  equal(p.drafts.places(), [])
  p.mode.stop()
})

test('an item left empty goes, and the last item stays', async () => {
  let p = await listed()
  let [members, visitors] = p.items()
  p.press(members, 'pointerdown')
  p.key(members, 'Enter')
  p.press(p.q('h1'), 'pointerdown')
  equal(p.words(), ['Members', 'Visitors'])
  p.press(visitors, 'pointerdown')
  p.type(visitors, '')
  p.key(visitors, 'Backspace')
  p.type(members, '')
  ok(!p.key(members, 'Backspace').defaultPrevented)
  equal(p.items().length, 1)
  p.mode.stop()
})

test('an item moves with Alt and an arrow, and by dragging its handle', async () => {
  let p = await listed()
  let [members, visitors] = p.items()
  p.press(visitors, 'pointerdown')
  p.key(visitors, 'ArrowUp', { altKey: true })
  equal(p.words(), ['Visitors', 'Members'])
  equal(listOf(p.drafts.text(ALWAYS)), ['Visitors', 'Members'])
  // Each item a row 20px tall; the handle drags Visitors to the second row.
  let row = (top: number) => () =>
    ({ left: 40, top, width: 200, height: 20 }) as DOMRect
  members.getBoundingClientRect = row(20)
  visitors.getBoundingClientRect = row(0)
  let handle = p.doc.querySelector('[data-yak-handle]')!
  ok(!(handle as HTMLElement).hidden)
  let pointer = (type: string, y: number) =>
    handle.dispatchEvent(
      Object.assign(
        new (p.doc.defaultView!.Event)(type, { cancelable: true }),
        {
          clientX: 50,
          clientY: y,
        },
      ),
    )
  pointer('pointerdown', 10)
  pointer('pointermove', 32)
  pointer('pointerup', 32)
  equal(p.words(), ['Members', 'Visitors'])
  await p.settled()
  equal(p.drafts.places(), [])
  p.mode.stop()
  ok(!p.doc.querySelector('[data-yak-handle]'))
})

test('Save sends the list whole, and a list typed on another device is drawn', async () => {
  let p = await listed({ save: OK({ version: 5, keys: ['always'] }) })
  p.heard(ALWAYS, '["Members","Visitors","Guests"]')
  equal(
    p.q('ul').innerHTML,
    '<li class="Plan_Item">Members</li><li class="Plan_Item">Visitors</li><li class="Plan_Item">Guests</li>',
  )
  p.press(p.button('save'))
  await p.settled()
  equal(p.sent.map((s) => s.body), [{
    copy: { always: ['Members', 'Visitors', 'Guests'] },
  }])
  equal(p.drafts.places(), [])
  equal(p.words(), ['Members', 'Visitors', 'Guests'])
  p.mode.stop()
  equal(p.words(), ['Members', 'Visitors', 'Guests'])
})

test('off, a list shows its own items again', async () => {
  let p = await listed()
  let [members] = p.items()
  p.press(members, 'pointerdown')
  p.key(members, 'Enter')
  p.type(p.items()[1], 'Guests')
  p.mode.stop()
  equal(p.words(), ['Members', 'Visitors'])
  equal(
    p.q('ul').innerHTML,
    '<li class="Plan_Item">Members</li><li class="Plan_Item">Visitors</li>',
  )
})
