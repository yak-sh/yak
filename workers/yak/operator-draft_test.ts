// The Operator chat app's own script, run over linkedom with its fetches answered
// by operatorAnswer, loaded again and again over one localStorage: what a
// person typed is kept when the page is left with its save cut off.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import type { Stash } from '@yaks/draft'
import { browserDrafts } from '../../packages/draft/browser.ts'
import { directoryOf } from './directory.ts'
import { platform } from './testing.ts'
import { type Beside, chatPage, operatorAnswer } from './operator-page.ts'
import { redraw } from './public/redraw.js'

let p = platform('operator-draft')
let person = crypto.randomUUID(), eid = crypto.randomUUID()
await directoryOf(p.env.STORE).apply({
  entities: [
    { entity: { eid: person }, person: {} },
    {
      entity: { eid },
      space: { slug: 'clerk', store: 'clerk' },
      doc: { title: 'Township' },
    },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: eid, role: 'owner' },
    },
  ],
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })
let space = (await directoryOf(p.env.STORE).at(eid))!
let who = { person, role: 'owner' as const, space: eid }
let base = 'https://yaks.app/manage/clerk/operator'
let serve = async (url: string | URL, init?: RequestInit) =>
  (await operatorAnswer(
    new Request(new URL(url, base), init),
    p.env,
    space,
    who,
  ))!

// One browser's localStorage, kept across loads of the page.
let storage = (): Stash => {
  let items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  }
}

// A load of the page: its script run as served. `cut` holds every save that
// leaves while the person is on it, as a page that is left before they land.
let load = async (
  stash: Stash,
  cut = false,
  open = 'new',
  beside: Beside = {},
  app?: string,
) => {
  let html = await (await chatPage(p.env, space, who, open, beside, app))
    .text()
  let { document, Event } = parseHTML(html)
  // What linkedom's forms lack: their fields by name, their action, and a
  // FormData of them.
  for (let form of document.querySelectorAll('form')) {
    let named = (name: string) => form.querySelector(`[name="${name}"]`)
    Object.defineProperty(form, 'elements', {
      value: new Proxy({}, { get: (_, name) => named(String(name)) }),
    })
    Object.defineProperty(form, 'action', {
      value: form.getAttribute('action'),
    })
  }
  class FormOf extends FormData {
    constructor(form: Element) {
      super()
      for (let field of form.querySelectorAll('[name]')) {
        let { name, value, type } = field as HTMLInputElement
        if (type != 'file') this.set(name, value)
      }
    }
  }
  let timers = new Set<ReturnType<typeof setTimeout>>()
  let after = (fn: () => void, ms: number) => {
    let t = setTimeout(() => (timers.delete(t), fn()), ms)
    timers.add(t)
    return t
  }
  // The draft reads the page has had answered, each taken in before the next.
  let reads = 0
  let fetch = async (url: string, init?: RequestInit) => {
    if (cut && init?.method == 'POST') return new Promise<Response>(() => {})
    let answer = await serve(url, init)
    if (url.includes('draft=1') && !init?.method) {
      queueMicrotask(() => void reads++)
    }
    return answer
  }
  let kept: ReturnType<typeof browserDrafts>[] = []
  let opened: typeof browserDrafts = (client, scope, opts) => {
    let d = browserDrafts(client, scope, { ...opts, stash, pace: 0 })
    kept.push(d)
    return d
  }
  // linkedom keeps no focus or selection: the box records being given it.
  let say = document.querySelector('[name=say]') as HTMLTextAreaElement
  let focused = false
  say.focus = () => void (focused = true)
  say.setSelectionRange = () => {}
  // Each load of the app beside the chat, and of the page.
  let loads = { app: 0, page: 0 }
  let frame = document.querySelector('[data-frame]')
  if (frame) {
    Object.defineProperty(frame, 'src', {
      get: () => frame.getAttribute('src'),
      set: () => void loads.app++,
    })
  }
  // The page's socket, which a test speaks for.
  let sockets: { onmessage?: (e: { data: string }) => void }[] = []
  let source = document.querySelector('script[type=module]')!.textContent!
    .replace(/^import .*$/gm, '')
  new Function(
    'browserDrafts',
    'redraw',
    'document',
    'fetch',
    'location',
    'setTimeout',
    'clearTimeout',
    'FormData',
    'WebSocket',
    'Event',
    source,
  )(
    opened,
    redraw,
    document,
    fetch,
    { reload: () => void loads.page++, origin: 'https://yaks.app' },
    after,
    clearTimeout,
    FormOf,
    // A socket that never opens: the page polls, as with none.
    class {
      onopen?: () => void
      onmessage?: () => void
      onclose?: () => void
      constructor() {
        sockets.push(this)
      }
    },
    Event,
  )
  return {
    say,
    focused,
    loads,
    document,
    // A frame the Operator's socket sends the page.
    hear: (frame: unknown) =>
      sockets[0].onmessage!({ data: JSON.stringify(frame) }),
    press: (button: Element) =>
      button.dispatchEvent(new Event('click', { bubbles: true })),
    // Once the page has heard the store's drafts.
    heard: async () => {
      while (!reads) await new Promise((ok) => setTimeout(ok, 1))
      await settle()
    },
    type: (text: string) => {
      say.value = text
      say.dispatchEvent(new Event('input'))
    },
    send: () => {
      let form = document.querySelector('#ask')!
      form.dispatchEvent(new Event('submit', { cancelable: true }))
    },
    leave: () => {
      for (let t of timers) clearTimeout(t)
      for (let d of kept) d.close()
    },
  }
}
let settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((ok) => setTimeout(ok, 1))
}
let stored = async (place = 'operator:new') =>
  ((await (await serve(`${base}?draft=1`)).json()).bundles as {
    draft: { place: string; text: string }
  }[]).find((b) => b.draft.place == place)?.draft.text ?? ''

let stash = storage()
let first = await load(stash, true)
await settle()
first.type('Post the road millage notice')
await settle()
let unsaved = await stored()
first.leave()

let second = await load(stash)
await settle()
let shown = second.say.value
let saved = await stored()
second.type('Post the road millage notice by Friday')
await settle()
second.leave()

let third = await load(stash, true)
await settle()
third.type('Post the road millage notice by Friday, with the agenda')
third.send()
await settle()
let sending = third.say.value
third.leave()

let fourth = await load(stash)
await settle()
let resent = fourth.say.value
let afterSend = await stored()
fourth.leave()

test("words typed in the Operator's chat app are kept when it is left mid save", () => {
  assertEquals(unsaved, '', 'the save never landed')
  assertEquals(shown, 'Post the road millage notice')
  assertEquals(saved, 'Post the road millage notice')
})

test("a message sent as the Operator's chat app is left comes back as its draft", () => {
  assertEquals(sending, '')
  assertEquals(
    resent,
    'Post the road millage notice by Friday, with the agenda',
  )
  assertEquals(
    afterSend,
    'Post the road millage notice by Friday, with the agenda',
  )
})

// Two conversations, each begun by a message sent without the page's script
// and taken up by a session: the builder's alarm, delivered here, drains the
// work the message owes, which its own nudge only starts.
let begun = async (say: string) => {
  let body = new FormData()
  body.set('say', say)
  let sent = await serve(base, { method: 'POST', body })
  await p.builder(eid).alarm()
  return sent.headers.get('location')!.split('/').at(-1)!
}
let road = await begun('Post the road millage notice')
let park = await begun('Book the park pavilion for June')

let onRoad = await load(stash, false, road)
await onRoad.heard()
let roadFocused = onRoad.focused
onRoad.type('Add the hearing date')
await settle()
onRoad.leave()

let onPark = await load(stash, false, park)
await onPark.heard()
let parkShown = onPark.say.value
onPark.type('Ask for the north shelter')
await settle()
onPark.leave()

let backOnRoad = await load(stash, false, road)
await backOnRoad.heard()
let roadShown = backOnRoad.say.value
backOnRoad.leave()

let fresh = await load(stash)
await fresh.heard()
let freshFocused = fresh.focused
fresh.leave()

test('each Operator conversation keeps its own draft', async () => {
  assertEquals(parkShown, '')
  assertEquals(roadShown, 'Add the hearing date')
  assertEquals(await stored('operator:' + road), 'Add the hearing date')
  assertEquals(await stored('operator:' + park), 'Ask for the north shelter')
})

test('opening or starting a conversation puts the cursor in the message box', () => {
  assertEquals(roadFocused, true)
  assertEquals(freshFocused, true)
})

let apps = {
  apps: [
    { eid: 'notes', slug: 'notes', title: 'Notes' },
    { eid: 'club', slug: 'club', title: 'Club' },
  ],
}
let changing = (task: string, ...changed: object[]) => ({
  operator: { task, rows: [], now: '', changed },
})

test('a way to start fills the box with its words, for the person to finish', async () => {
  let page = await load(storage(), false, 'new', apps)
  page.press(page.document.querySelector('[data-say]')!)
  assertEquals(page.say.value, 'Make me an app for ')
  assertEquals(page.focused, true)
  page.leave()
})

test('the app beside the chat loads again when the Operator changes it, and only then', async () => {
  let page = await load(storage(), false, 'new', apps, 'notes')
  page.hear(changing('x', { space: '', app: 'club' }))
  page.hear(changing('x', { space: 'mill', app: 'notes' }))
  page.hear(changing('x', { space: 'clerk', app: 'notes' }))
  page.hear(changing('x', { space: '', app: 'notes' }))
  assertEquals(page.loads, { app: 2, page: 0 })
  page.leave()
})

test('a chat with no app beside it opens again to show one it changed, unless the person is writing', async () => {
  let page = await load(storage(), false, road, apps)
  let task = page.document.querySelector('[data-task]')!.getAttribute(
    'data-task',
  )!
  // Another chat's change, or one to an app they may not open, opens nothing.
  page.hear(changing(crypto.randomUUID(), { space: '', app: 'club' }))
  page.hear(changing(task, { space: '', app: 'secret' }))
  assertEquals(page.loads.page, 0)
  page.hear(changing(task, { space: '', app: 'club' }))
  assertEquals(page.loads.page, 1)
  page.type('Make the header')
  page.hear(changing(task, { space: '', app: 'club' }))
  assertEquals(page.loads.page, 1)
  page.leave()
})
