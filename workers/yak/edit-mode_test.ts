// Edit mode on an app's page (edit-mode.ts), in a linkedom page with the
// person's real draft desk over a store that answers at once: no network, no
// browser.
import { equal, ok, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { browserDrafts } from '@yaks/draft/browser'
import type { Bundle } from '@yaks/graph'
import { editMode, placeOf } from './edit-mode.ts'

let BODY = `
<h1 data-copy="hero.title">Build your ideas</h1>
<p data-copy="cost.limits">Tax is included. <a href="/pricing" data-copy-slot="plans" data-copy="cost.plans">Compare plans</a>.</p>
<button data-copy="cta">Start</button>
<footer><span data-copy="hero.title">Build your ideas</span></footer>`

// What the app's save door answers, by path, and what it was sent.
type Answer = { status: number; body: unknown }
let OK = (body: unknown): Answer => ({ status: 200, body })

let load = async (body = BODY, answers: Record<string, Answer> = {}) => {
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
  let mode = editMode(doc, drafts, {
    panel,
    at: '/cookbook/',
    fetch: (url, init) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      let path = String(url).split('/api/')[1]
      let { status, body } = answers[path] ?? { status: 404, body: null }
      return Promise.resolve(Response.json(body, { status }))
    },
    ask: 'https://yaks.app/manage/ada?app=cookbook',
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
  equal(p.shown(), 'Press any outlined words to change them ·  · Done')
  p.mode.stop()
  ok(!p.doc.documentElement.hasAttribute('data-yak-editing'))
  equal(p.says(), '')
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
  equal(p.shown(), 'Press any outlined words to change them ·  · Done')
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
    'Press any outlined words to change them · Saved as version 4 · Undo · Done',
  )
  p.mode.stop()
  equal(p.q('footer span').textContent, 'Build it by asking')
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
