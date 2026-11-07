// The Operator chat app's own script, run over linkedom with its fetches answered
// by operatorAnswer, loaded again and again over one localStorage: what a
// person typed is kept when the page is left with its save cut off. And the
// app beside the chat, drawn again as the Operator works on it, which a
// page opens as their Operator starts making it.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import type { Stash } from '@yaks/draft'
import { browserDrafts } from '../../packages/draft/browser.ts'
import { directoryOf } from './directory.ts'
import { platform } from './testing.ts'
import { type Beside, chatPage, operatorAnswer } from './operator-page.ts'
import type { Who } from './session.ts'
import { redraw } from './public/redraw.js'
import { released } from './operator-testing.ts'
import { TOOLS } from './tools.ts'
import { when } from './public/when.js'

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
// The one of their apps the person opens beside the chat.
await released(
  { env: p.env, dir: directoryOf(p.env.STORE), person },
  'notes',
  'Notes',
)
let base = 'https://yaks.app/manage/clerk/operator'
let serve = async (url: string | URL, init?: RequestInit, as: Who = who) =>
  (await operatorAnswer(
    new Request(new URL(url, base), init),
    p.env,
    space,
    as,
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
// `network` 'held' holds its first draft read and its socket unanswered, as a
// network can, until the page's time limit gives each up; 'deploying' answers
// the first read of each address 502, as the edge does while a deploy replaces
// the Worker; 'down' fails every draft read. Under any, the page's waits run a
// thousand times faster.
let load = async (
  stash: Stash,
  cut = false,
  open = 'new',
  beside: Beside = {},
  app?: string,
  network?: 'held' | 'deploying' | 'down',
  as: Who = who,
) => {
  let html = await (await chatPage(p.env, space, as, open, beside, app))
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
    let t = setTimeout(() => (timers.delete(t), fn()), network ? ms / 1000 : ms)
    timers.add(t)
    return t
  }
  // The draft reads the page has had answered, each taken in before the next.
  let reads = 0
  let holding = network == 'held'
  let failed = new Set<string>()
  // Each draft read the page asks, answered or not.
  let asked = 0
  let fetch = async (url: string, init?: RequestInit) => {
    if (cut && init?.method == 'POST') return new Promise<Response>(() => {})
    if (url.includes('draft=1') && !init?.method) asked++
    if (network == 'down' && url.includes('draft=1') && !init?.method) {
      throw new TypeError('Failed to fetch')
    }
    if (network == 'deploying' && !init?.method && !failed.has(url)) {
      failed.add(url)
      return new Response('Bad Gateway', { status: 502 })
    }
    if (holding && url.includes('draft=1') && init?.signal) {
      holding = false
      return new Promise<Response>((_, no) =>
        // the time limit, passed
        queueMicrotask(() => no(new DOMException('timed out', 'TimeoutError')))
      )
    }
    let answer = await serve(url, init, as)
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
    'when',
    'setInterval',
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
    when,
    // the stamps' minute, which no test waits for
    () => 0,
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
      close() {
        queueMicrotask(() => this.onclose?.())
      }
    },
    Event,
  )
  return {
    say,
    focused,
    loads,
    document,
    sockets,
    // What the page says under its box.
    status: () => document.querySelector('[data-send-status]')!.textContent,
    failed,
    asked: () => asked,
    // The Operator's socket opening, as after a deploy restarted it.
    open: () => (sockets[0] as { onopen: () => void }).onopen(),
    // A frame the Operator's socket sends the page.
    hear: (frame: unknown) =>
      sockets[0].onmessage!({ data: JSON.stringify(frame) }),
    press: (button: Element) =>
      button.dispatchEvent(new Event('click', { bubbles: true })),
    // Whether the page has heard the store's drafts.
    read: () => reads > 0,
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

let apps = {
  apps: [
    { eid: 'notes', slug: 'notes', title: 'Notes' },
    { eid: 'club', slug: 'club', title: 'Club' },
  ],
}
// Before the person has written, the space's address is a new chat, with ways
// to start.
let starting = await load(storage(), false, 'new', apps)

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

let changing = (task: string, ...changed: object[]) => ({
  operator: { task, rows: [], now: '', changed },
})

test('a way to start fills the box with its words, for the person to finish', () => {
  let page = starting
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

test('a chat with no app beside it stays as it is when the Operator changes one', async () => {
  let page = await load(storage(), false, road, apps)
  let task = page.document.querySelector('[data-task]')!.getAttribute(
    'data-task',
  )!
  page.hear(changing(task, { space: '', app: 'club' }))
  assertEquals(page.loads, { app: 0, page: 0 })
  page.leave()
})

// A step that worked on these apps, as the Operator's socket tells it.
let working = (...worked: object[]) => ({
  operator: { task: 'x', rows: [], now: '', worked },
})
let files = (person: string, app: string, ...written: [string, unknown][]) =>
  TOOLS.find((t) => t.name == 'app_files')!.run(
    { env: p.env, dir: directoryOf(p.env.STORE), person },
    {
      app,
      files: written.map(([path, content]) => ({
        path,
        content: typeof content == 'string' ? content : JSON.stringify(content),
      })),
    },
  )
// What the app beside a page says it keeps, and which of its tabs is open.
let made = (document: Document) => ({
  keeps: [...document.querySelectorAll('[data-part=keeps] .Rows_Name')]
    .map((e) => e.textContent),
  open: [...document.querySelectorAll('[name=made]')]
    .filter((r) => r.hasAttribute('checked') || (r as HTMLInputElement).checked)
    .map((r) => r.getAttribute('value')),
})

test('what the app beside the chat is made of is drawn again as the Operator works on it, its screens left loaded', async () => {
  let page = await load(storage(), false, 'new', apps, 'notes')
  let { document } = page
  let frames = () =>
    [...document.querySelectorAll('[data-frame]')].map((f) =>
      f.getAttribute('data-frame')
    )
  assertEquals(made(document), { keeps: [], open: ['screens'] })
  assertEquals(frames(), ['live'])
  let wrote = async (properties: object) => {
    await files(person, 'notes', [
      'vocab.json',
      { $defs: { notice: { properties } } },
    ])
    page.hear(working({ space: 'mill', app: 'notes' }))
    page.hear(working({ space: '', app: 'notes' }))
  }
  // The first change to the live app puts its draft beside it.
  await wrote({ posted: { type: 'string' } })
  assert(await until(() => made(document).keeps.length > 0))
  assertEquals(made(document), { keeps: ['Notice'], open: ['screens'] })
  assertEquals(frames(), ['draft', 'live'])
  // The next leaves both frames as they are.
  let screens = document.querySelector('[data-frame]')
  await wrote({ posted: { type: 'string' }, title: { type: 'string' } })
  assert(
    await until(() =>
      document.querySelector('[data-part=keeps] .Rows_Meta')?.textContent ==
        'Posted and title'
    ),
  )
  assert(document.querySelector('[data-frame]') === screens)
  assertEquals(page.loads, { app: 0, page: 0 })
  page.leave()
})

// A newcomer (newcomer.ts), whose Operator is making them an app.
let newcomer = crypto.randomUUID()
await directoryOf(p.env.STORE).apply({
  entities: [
    {
      entity: { eid: newcomer },
      person: {},
      newcomer: { at: new Date().toISOString() },
    },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person: newcomer, space: eid, role: 'owner' },
    },
  ],
}, { 'x-yak-person': person, 'x-yak-role': 'owner' })
await TOOLS.find((t) => t.name == 'app_new')!.run(
  { env: p.env, dir: directoryOf(p.env.STORE), person: newcomer },
  { slug: 'recipes', title: 'Recipe box' },
)

test("a newcomer's chat opens the app their Operator is making beside it, then its screens as the first is drawn", async () => {
  let page = await load(
    storage(),
    false,
    'new',
    {},
    undefined,
    undefined,
    { person: newcomer, role: 'owner' },
  )
  let { document } = page
  assertEquals(document.querySelector('[data-app]'), null)
  await files(newcomer, 'recipes', ['vocab.json', {
    $defs: { recipe: { properties: { serves: { type: 'number' } } } },
  }])
  page.hear(working({ space: '', app: 'recipes' }))
  assert(await until(() => made(document).keeps.length > 0))
  assertEquals(made(document), { keeps: ['Recipe'], open: ['keeps'] })
  assert(document.querySelector('.Talk')!.classList.contains('Talk-app'))
  assertEquals(
    document.querySelector('.Talk_Bar .Talk_Show')?.textContent,
    'Recipe box',
  )
  assertEquals(document.querySelector('[data-frame]'), null)
  // The first page drawn opens its screens: the draft, as it stands.
  await files(newcomer, 'recipes', ['index.html', '<h1>Recipes</h1>'])
  page.hear(working({ space: '', app: 'recipes' }))
  assert(await until(() => !!document.querySelector('[data-frame]')))
  assertEquals(made(document).open.at(-1), 'screens')
  assertStringIncludes(
    document.querySelector('[data-frame]')!.getAttribute('src')!,
    'https://clerk.yaks.app/recipes/_preview/',
  )
  page.leave()
})

test('a signed-in person’s chat opens beside it an app their Operator starts there, and not one it only works on', async () => {
  let page = await load(storage())
  let app = () => page.document.querySelector('[data-app]')
  page.hear(working({ space: '', app: 'notes' }))
  await settle()
  assertEquals(app(), null)
  let recipes = { space: '', app: 'recipes' }
  page.hear({ operator: { ...working(recipes).operator, started: [recipes] } })
  assert(await until(() => app()?.getAttribute('data-app') == 'recipes'))
  page.leave()
})

test('words typed on one page show on the person’s other open page as its socket brings them', async () => {
  let here = await load(storage(), false, park),
    there = await load(storage(), false, park)
  await Promise.all([here.heard(), there.heard()])
  here.type('Ask for the south shelter instead')
  await settle()
  let { bundles } = await (await serve(`${base}?draft=1`)).json()
  there.hear({ drafts: bundles })
  await settle()
  assertEquals(there.say.value, 'Ask for the south shelter instead')
  here.leave()
  there.leave()
})

// A draft read and a socket the network never answers are given up and asked
// again, so the draft still arrives and the socket opens anew.
let hold = storage()
let typed = await load(hold)
await typed.heard()
typed.type('Order salt for the township garage')
await settle()
typed.leave()
// Whether `ok` comes true within two seconds.
let until = async (ok: () => boolean) => {
  for (let end = Date.now() + 2000; !ok() && Date.now() < end;) {
    await new Promise((go) => setTimeout(go, 1))
  }
  return ok()
}
let waited = await load(storage(), false, 'new', {}, undefined, 'held')
let reread = await until(waited.read)
await settle()
let reopened = await until(() => waited.sockets.length > 1)
waited.leave()

test("the Operator's chat app reads its draft again when a read is never answered", () => {
  assertEquals([reread, reopened], [true, true])
  assertEquals(waited.say.value, 'Order salt for the township garage')
})

test('a page whose reads meet a deploy’s 502 reads again and catches up quietly', async () => {
  let page = await load(storage(), false, park, {}, undefined, 'deploying')
  let box = page.document.querySelector('[data-conversation]')!
  box.innerHTML = ''
  page.open()
  await page.heard()
  for (let i = 0; i < 200 && !box.innerHTML; i++) await settle()
  assertEquals(page.failed.size, 2, 'the draft and the conversation met it')
  assertEquals(!!box.innerHTML, true, 'the conversation is drawn again')
  assertEquals(page.status(), '')
  page.leave()
})

test('a page reads its draft only as it opens and as its socket opens, never on a timer', async () => {
  let page = await load(storage(), false, 'new', {}, undefined, 'down')
  // ask's five tries, then a hundred seconds more, sped up
  await new Promise((ok) => setTimeout(ok, 120))
  let alone = page.asked()
  page.open()
  await new Promise((ok) => setTimeout(ok, 120))
  let opened = page.asked()
  page.leave()
  assertEquals([alone, opened], [5, 10])
})
