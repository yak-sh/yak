// The Operator chat app's own script, run over linkedom with its fetches answered
// by operatorAnswer, loaded again and again over one localStorage: what a
// person typed is kept when the page is left with its save cut off. And the
// app beside the chat, drawn again as the Operator works on it, which a
// page opens as their Operator starts making it.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import type { Stash } from '@yaks/draft'
import { imported } from '@yaks/fp/imports'
import { parts } from './client-assets.ts'
import { directoryOf } from './directory.ts'
import { platform } from './testing.ts'
import { type Beside, chatPage, operatorAnswer } from './operator-page.ts'
import type { Who } from './session.ts'
import { pageModule } from './page-module-probe.ts'
import { released } from './operator-testing.ts'
import { openedOf, operatorFrames } from './operator-host.ts'
import { operatorStore } from './operator-store.ts'
import { inputOf } from './operator-root.ts'
import { TOOLS } from './tools.ts'

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

// A browser that hears and speaks (public/voice.js), for the load that sets
// it: what it is told it heard, and what it says.
type Recognized = { onresult?: (e: unknown) => void; onend?: () => void }
let talker = () => {
  let t = {
    heard: null as Recognized | null,
    spoken: [] as string[],
    platform: (Event: unknown) => ({
      Recognition: class {
        constructor() {
          t.heard = this as Recognized
        }
        start() {}
        stop() {}
      },
      synthesis: {
        speak: (u: { text: string }) => void (u.text && t.spoken.push(u.text)),
        cancel: () => {},
      },
      Utterance: class {
        constructor(public text: string) {}
      },
      fetch,
      lang: 'en',
      setTimeout,
      Event,
    }),
    says: (words: string) =>
      t.heard!.onresult!({ results: [[{ transcript: words }]] }),
    stops: () => t.heard!.onend!(),
  }
  return t
}
let speaking: ReturnType<typeof talker> | undefined

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
  for (
    let trigger of document.querySelectorAll<HTMLElement>('[data-menu-trigger]')
  ) {
    trigger.getBoundingClientRect =
      () => ({ left: 20, top: 20, bottom: 40, width: 80 } as DOMRect)
  }
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
    Object.defineProperty(form, 'requestSubmit', {
      value: () =>
        form.dispatchEvent(new Event('submit', { cancelable: true })),
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
  let left = false
  let timers = new Set<ReturnType<typeof setTimeout>>()
  let after = (fn: () => void, ms: number) => {
    if (left) return 0
    let t = setTimeout(
      () => (timers.delete(t), fn()),
      network || ms < 1000 ? ms / 1000 : ms,
    )
    timers.add(t)
    return t
  }
  // The draft reads the page has had answered, each taken in before the next.
  let reads = 0
  let holding = network == 'held'
  let failed = new Set<string>()
  // Each draft read the page asks, answered or not, and each read of the
  // conversation.
  let asked = 0, talks = 0
  let fetch = async (url: string, init?: RequestInit) => {
    if (url.includes('?talk=') && slow) {
      let answer = await serve(url, init, as)
      talks++
      await slow
      if (left) return new Promise<Response>(() => {})
      return answer
    }
    if (cut && init?.method == 'POST') return new Promise<Response>(() => {})
    if (url.includes('draft=1') && !init?.method) asked++
    if (url.includes('?talk=')) talks++
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
    if (left) return new Promise<Response>(() => {})
    if (url.includes('draft=1') && !init?.method) {
      queueMicrotask(() => void reads++)
    }
    return answer
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
  // The page's socket, which a test speaks for, or carries to the Builder
  // object as the edge does (`connect`).
  type Page = {
    url: string
    onopen?: () => void
    onmessage?: (e: { data: string }) => void
  }
  let sockets: Page[] = []
  let source = document.querySelector('script[type=module]')!.textContent!
  // Generated bundles still depend on the source graph that builds them.
  imported(
    Object.values(parts).map((from) => new URL(from, import.meta.url).href),
  )
  let place = {
    reload: () => void loads.page++,
    origin: 'https://yaks.app',
    href: base + '/' + open,
  }
  let copied: string[] = []
  // The browser's interfaces belong to this load, including those used inside
  // imported modules: storage, speech, timers and the page's socket.
  await pageModule(source, {
    at: base,
    read: async (url) => {
      let response = await p.env.ASSETS.fetch(new Request(url))
      if (!response.ok) throw new Error(`${url}: ${response.status}`)
      return response.text()
    },
    globals: {
      document,
      fetch,
      location: place,
      navigator: {
        clipboard: {
          writeText: (text: string) => Promise.resolve(void copied.push(text)),
        },
      },
      innerWidth: 320,
      innerHeight: 600,
      localStorage: stash,
      setInterval: () => 0,
      setTimeout: after,
      clearTimeout,
      FormData: FormOf,
      Event,
      scrollTo: () => {},
      addEventListener: () => {},
      ...speaking
        ? {
          SpeechRecognition: speaking.platform(Event).Recognition,
          speechSynthesis: speaking.platform(Event).synthesis,
          SpeechSynthesisUtterance: speaking.platform(Event).Utterance,
        }
        : {},
      WebSocket: class {
        onopen?: () => void
        onmessage?: () => void
        onclose?: () => void
        constructor(public url: string) {
          sockets.push(this)
        }
        close() {
          queueMicrotask(() => this.onclose?.())
        }
      },
    },
  })
  return {
    say,
    focused,
    copied,
    loads,
    document,
    sockets,
    // What the page says under its box.
    status: () => document.querySelector('[data-send-status]')!.textContent,
    failed,
    asked: () => asked,
    talks: () => talks,
    // The Operator's socket opening, as after a deploy restarted it.
    open: () => (sockets[0] as { onopen: () => void }).onopen(),
    // The page's newest socket upgraded through the Builder object, which
    // speaks for it from then on.
    connect: async () => {
      let page = sockets.at(-1)!
      let held: unknown = null, opened = false
      // What the Builder says before the page hears its socket open comes
      // after, as a browser delivers it.
      let early: string[] = []
      let factory = globalThis as { WebSocketPair?: unknown }
      factory.WebSocketPair = function () {
        return {
          0: {},
          1: {
            send: (data: string) =>
              opened ? page.onmessage?.({ data }) : void early.push(data),
            serializeAttachment: (v: unknown) =>
              void (held = structuredClone(v)),
            deserializeAttachment: () => held,
          },
        }
      }
      try {
        let url = page.url.replace(/^ws/, 'http')
        await serve(url, { headers: { upgrade: 'websocket' } }, as)
      } finally {
        delete factory.WebSocketPair
      }
      page.onopen?.()
      opened = true
      for (let data of early.splice(0)) page.onmessage?.({ data })
    },
    // A frame the Operator's socket sends the page.
    hear: (frame: unknown) =>
      sockets[0].onmessage!({ data: JSON.stringify(frame) }),
    press: (button: Element) =>
      button.dispatchEvent(new Event('click', { bubbles: true })),
    // A key pressed on the page.
    key: (key: string) =>
      document.dispatchEvent(
        Object.assign(new Event('keydown', { bubbles: true }), { key }),
      ),
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
      left = true
      for (let t of timers) clearTimeout(t)
    },
  }
}
let settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((ok) => setTimeout(ok, 1))
}
// While set, a read of the conversation is answered as the store stood when
// it was asked, but reaches the page only once this settles.
let slow: Promise<void> | undefined
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
// work the message owes, which its own nudge only starts, and both go on
// after they answer, until the platform is settled.
let begun = async (say: string) => {
  let body = new FormData()
  body.set('say', say)
  let sent = await serve(base, { method: 'POST', body })
  await p.builder(eid).alarm()
  await p.settled()
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

test('the microphone stays hidden where neither the browser nor the platform hears', async () => {
  let page = await load(storage())
  assertEquals(
    page.document.querySelector('[data-voice]')!.hasAttribute('hidden'),
    true,
  )
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
  let address = document.querySelector('[data-address=draft]')!
  let navigated = address.getAttribute('href')! + 'notices?q=tea#today'
  address.setAttribute('href', navigated)
  address.textContent = navigated
  await wrote({ posted: { type: 'string' }, title: { type: 'string' } })
  assert(
    await until(() =>
      document.querySelector('[data-part=keeps] .Rows_Meta')?.textContent ==
        'Posted and title'
    ),
  )
  assert(document.querySelector('[data-frame]') === screens)
  assertEquals(document.querySelector('[data-address=draft]'), address)
  assertEquals(address.getAttribute('href'), navigated)
  assertEquals(address.textContent, navigated)
  assertEquals(
    document.querySelector('[data-open]')?.getAttribute('href'),
    navigated,
  )
  assertEquals(page.loads, { app: 0, page: 0 })
  page.leave()
})

test('a page pressed in What it can do brings Screens forward, where it opens', async () => {
  let page = await load(storage(), false, 'new', apps, 'notes')
  let screens = page.document.querySelector(
    '[name=made][value=screens]',
  ) as HTMLInputElement
  // Another tab picked, as linkedom's radios do not uncheck each other.
  screens.checked = false
  page.press(page.document.querySelector('[data-shows]')!)
  assertEquals(screens.checked, true)
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
  // where the conversation stands, moved by a line the page has not drawn
  page.hear({ ready: true, standing: 'moved' })
  await page.heard()
  for (let i = 0; i < 200 && !box.innerHTML; i++) await settle()
  assertEquals(page.failed.size, 2, 'the draft and the conversation met it')
  assertEquals(!!box.innerHTML, true, 'the conversation is drawn again')
  assertEquals(page.status(), '')
  page.leave()
})

// The page is served with the conversation drawn, and its socket opening
// reads it again only when a line landed between the two.
test('opening the chat app reads the conversation once, with the page', async () => {
  let page = await load(storage(), false, park)
  await page.connect()
  await settle()
  let still = page.talks()
  page.leave()
  let landed = await load(storage(), false, park)
  let box = landed.document.querySelector('[data-conversation]')!
  await begun('Ask for the north shelter as well')
  await landed.connect()
  for (let i = 0; i < 100 && !landed.talks(); i++) await settle()
  await settle()
  landed.leave()
  assertEquals([still, landed.talks()], [0, 1])
  assertStringIncludes(box.innerHTML, 'Ask for the north shelter as well')
})

test('archive and restore while disconnected refresh the conversation once on reconnect', async () => {
  let store = operatorStore(p.states.get(`builder ${eid}`)!.storage)
  let id = ''
  for (let archived of [true, false]) {
    let page = await load(storage(), false, park)
    try {
      id ||= page.document.querySelector('[data-archive-entries]')!
        .getAttribute('data-archive-entries')!
      await store.g.apply([{
        entity: { eid: id },
        archived: archived ? {} : null,
      }], { trusted: true })
      await page.connect()
      let button = () =>
        page.document.querySelector(`[data-archive-entries="${id}"]`)
      for (let i = 0; i < 200; i++) {
        if (button()?.getAttribute('data-restore') == String(archived)) break
        await settle()
      }
      assertEquals(page.talks(), 1)
      assertEquals(button()?.getAttribute('data-restore'), String(archived))
    } finally {
      page.leave()
    }
  }
})

// The person's words are on the page from the moment they are sent: a read
// while the Operator has yet to take them in draws them where their line
// will be, and that line takes their place, once.
test('words sent are drawn before the Operator takes them in, then once as its line', async () => {
  let body = new FormData()
  body.set('say', 'Ask the shelter about tables')
  body.set('request', crypto.randomUUID())
  await serve(base, { method: 'POST', body })
  let read = async () =>
    (await (await serve(`${base}?talk=${park}`)).json()).html as string
  let waiting = await read()
  await p.builder(eid).alarm()
  await p.settled()
  let taken = await read()
  let line = `id="row-${inputOf(String(body.get('request')))}"`
  assertEquals(
    [waiting, taken].map((html) => [
      [...parseHTML(html).document.querySelectorAll('.Transcript_Bubble')]
        .filter((
          node,
        ) => node.textContent == 'Ask the shelter about tables').length,
      html.includes(line),
    ]),
    [[1, true], [1, true]],
  )
})

// A read answers the conversation as it stood when asked: a line a step
// put in place meanwhile is read again, never drawn over.
test('a line heard while the page reads the conversation stays on it', async () => {
  let page = await load(storage(), false, park)
  await page.connect()
  await settle()
  let box = page.document.querySelector('[data-conversation]')!
  let release = () => {}
  slow = new Promise((ok) => release = ok)
  page.hear({ ready: true, standing: 'moved' })
  while (!page.talks()) await settle()
  slow = undefined
  await begun('Ask for the lakeside shelter too')
  await settle()
  let heard = box.innerHTML.includes('Ask for the lakeside shelter too')
  release()
  for (let i = 0; i < 100 && page.talks() < 2; i++) await settle()
  await settle()
  page.leave()
  assertEquals(
    [heard, box.innerHTML.includes('Ask for the lakeside shelter too')],
    [true, true],
  )
})

// Words of the person the page showed are never taken off it by a read that
// leaves them out, and the tracker hears of it then.
test(
  'a read that leaves out words the page showed keeps their order and reports it',
  async () => {
    let page = await load(storage(), false, park)
    await page.connect()
    await settle()
    let card = page.document.querySelector('[data-task]') as HTMLElement
    let ids = [crypto.randomUUID(), crypto.randomUUID()]
    let words = ['Keep my first words', 'Keep my next words']
    page.hear({
      operator: {
        task: card.dataset.task,
        lines: {
          lines: ids.map((id) => ({ id, uses: [id] })),
          entries: ids.map((id, i) => ({
            entity: { eid: id },
            content: { body: words[i] },
          })),
          helpers: [],
          offers: {},
          tools: {},
        },
        now: '',
      },
    })
    let rows = card.querySelector('[data-rows]')!
    // The omitted words were older than the surviving conversation, as in a
    // refresh whose displayed range starts too late.
    rows.prepend(
      ...ids.map((id) => page.document.getElementById('row-' + id)!),
    )
    let reported: string[] = []
    let was = globalThis.reportError
    globalThis.reportError = (e: unknown) => void reported.push(String(e))
    try {
      page.hear({ ready: true, standing: 'moved' })
      await until(() => reported.length == 2)
      assertEquals(
        [...page.document.querySelectorAll('[data-rows] > *')]
          .slice(0, 2).map((r) => r.textContent),
        words,
      )
      assertEquals(
        reported.sort(),
        ids.map((id) =>
          `Error: The Operator chat page left out words of the person it had shown: row-${id}`
        ).sort(),
      )
    } finally {
      globalThis.reportError = was
      page.leave()
    }
  },
  { tags: ['window'] },
)

// A helper's line, drawn under the step that started it, moves where the
// conversation stands as the conversation's own lines do.
test('a helper’s line landing before the socket opens is read, once', async () => {
  // The Builder object's store, beside the object, as another write lands.
  let store = operatorStore(p.states.get(`builder ${eid}`)!.storage)
  let { g } = store
  let { session } = await openedOf(store, park)
  let parent = session!.entity.eid
  let call = crypto.randomUUID(), helper = crypto.randomUUID()
  let told = (instructions: string) => ({
    entity: { eid: crypto.randomUUID() },
    entry: { session: helper },
    ask: {},
    sending: { instructions },
  })
  await g.apply([
    {
      entity: { eid: call },
      entry: { session: parent },
      call: { to: crypto.randomUUID(), args: {} },
    },
    { entity: { eid: helper }, session: {}, spawned: { parent, call } },
    told('Find the pavilion’s June dates'),
  ], { trusted: true })
  let page = await load(storage(), false, park)
  await page.connect()
  await settle()
  let still = page.talks()
  page.leave()
  let landed = await load(storage(), false, park)
  let box = landed.document.querySelector('[data-conversation]')!
  await g.apply([told('Find the north shelter’s June dates too')], {
    trusted: true,
  })
  await landed.connect()
  for (let i = 0; i < 100 && !landed.talks(); i++) await settle()
  await settle()
  landed.leave()
  assertEquals([still, landed.talks()], [0, 1])
  assertStringIncludes(
    box.innerHTML,
    'Find the north shelter’s June dates too',
  )
})

// The aside in the margin (operator-aside.ts), kept live from the graph: a
// helper's own page shows its turn under way as each of its steps lands, and
// the conversation that started it lists it with how it stands, linked to
// its run.
test('a helper’s page and its conversation’s aside follow its steps as they land', async () => {
  let store = operatorStore(p.states.get(`builder ${eid}`)!.storage)
  let { g } = store
  let { session } = await openedOf(store, park)
  let parent = session!.entity.eid
  let call = crypto.randomUUID(), helper = crypto.randomUUID()
  let step = (b: object) =>
    g.apply([{
      entity: { eid: crypto.randomUUID() },
      entry: { session: helper },
      ...b,
    }], { trusted: true })
  await g.apply([
    {
      entity: { eid: call },
      entry: { session: parent },
      call: { to: crypto.randomUUID(), args: {} },
    },
    { entity: { eid: helper }, session: {}, spawned: { parent, call } },
  ], { trusted: true })
  await step({ content: { body: 'Import the people CSV' }, using: {} })
  let own = await load(storage(), false, helper)
  let theirs = await load(storage(), false, park)
  let text = (page: typeof own, at: string) =>
    page.document.querySelector(at)?.textContent ?? ''
  let row = `#help-${helper}`
  let drawn = () => [
    text(own, '[data-turn]').replace(/\d+s$/, 'Ns'),
    text(theirs, row).replace(/\d+s$/, 'Ns'),
  ]
  let first = drawn()
  let link = theirs.document.querySelector(`${row} a`)?.getAttribute('href')
  // The Builder object's frames, to both pages' sockets.
  let frames = operatorFrames(store, () =>
    [own, theirs].map((page) => ({
      send: (data: string) => page.sockets[0].onmessage!({ data }),
      deserializeAttachment: () => ({
        operator: true,
        lines: true,
        person,
        space: eid,
        opens: link?.replace(/\/[^/]+$/, ''),
      }),
    })))
  await frames.tell(helper)
  let tool = crypto.randomUUID()
  await step({ ask: {}, using: {} })
  await step({
    entity: { eid: tool },
    call: { to: crypto.randomUUID(), args: {} },
  })
  await frames.tell(helper)
  let running = drawn()
  await step({ result: { call: tool }, content: { body: 'ok' } })
  await step({ output: {}, content: { body: 'Imported 100 people.' } })
  await frames.tell(helper)
  let ended = drawn()
  own.leave()
  theirs.leave()
  assertEquals(first, [
    'Thinking · Ns',
    'Import the people CSVRunning · Thinking · Ns',
  ])
  assertEquals(
    link?.endsWith(`/${helper}`),
    true,
    'the helper links to its run',
  )
  assertEquals(
    running[0].startsWith('Thinking'),
    false,
    'its tool, not thinking',
  )
  assertStringIncludes(running[1], 'Running · ')
  assertEquals(ended, ['Nothing running', 'Import the people CSVDone · Ns'])
  assertEquals(
    theirs.document.querySelector(`${row} a`)?.getAttribute('href'),
    link,
  )
})

// On a phone, or wherever the margin has no room, the aside is a summary at
// the bar's right end: a dot for the turn and each helper, how many more past
// four, and the whole list under the bar while it is open.
test('the aside’s summary in the bar shows a dot for each, “+N” past four, and opens to the list', async () => {
  let store = operatorStore(p.states.get(`builder ${eid}`)!.storage)
  let { g } = store
  let { session } = await openedOf(store, park)
  let parent = session!.entity.eid
  let line = (session: string, b: object) => ({
    entity: { eid: crypto.randomUUID() },
    entry: { session },
    ...b,
  })
  let helpers = Array.from({ length: 5 }, () => crypto.randomUUID())
  let ends = [
    { output: {}, content: { body: 'Imported.' } },
    { exception: {}, content: { body: 'The sandbox stopped.' } },
  ]
  for (let [i, helper] of helpers.entries()) {
    let call = crypto.randomUUID()
    await g.apply([
      line(parent, {
        entity: { eid: call },
        call: { to: crypto.randomUUID(), args: {} },
      }),
      { entity: { eid: helper }, session: {}, spawned: { parent, call } },
      line(helper, { content: { body: `Helper ${i}` }, using: {} }),
      ...ends[i] ? [line(helper, ends[i])] : [],
    ], { trusted: true })
  }
  let page = await load(storage(), false, park)
  let { document } = page
  let glance = () =>
    document.querySelector('.Talk_Bar [data-aside] [data-glance]')!
  let aside = document.querySelector('[data-aside]')!
  let dots = () =>
    [...glance().querySelectorAll('.Dot')].map((d) => d.className)
  let seen = () => ({
    open: aside.hasAttribute('data-open'),
    expanded: glance().getAttribute('aria-expanded'),
  })
  // Each the list draws, the turn under way among them.
  let listed = document.querySelectorAll('[data-helping] > *').length +
    document.querySelectorAll('[data-turn] time').length
  let first = {
    dots: dots(),
    more: glance().textContent,
    hidden: aside.hasAttribute('hidden'),
  }
  page.press(glance())
  let pressed = seen()
  page.press(glance())
  let again = seen()
  page.press(glance())
  page.key('Escape')
  let escaped = seen()
  page.press(glance())
  page.press(document.querySelector('[data-conversation]')!)
  let outside = seen()
  page.press(glance())
  // A helper's step lands while the list is open: its dot changes, and the
  // list stays open.
  let at = new Date().toISOString()
  page.hear({
    operator: {
      task: document.querySelector('[data-task]')?.getAttribute('data-task'),
      helping: {
        session: helpers[2],
        title: 'Helper 2',
        standing: 'failed',
        step: 'It stopped.',
        since: at,
        until: at,
      },
    },
  })
  let heard = { ...seen(), label: glance().getAttribute('aria-label') }
  page.leave()
  assertEquals(first.hidden, false)
  assertEquals(first.dots.length, 4, 'four dots, then how many more')
  assertEquals(listed >= 1 + helpers.length, true, 'the turn and each helper')
  assertEquals(first.more, `+${listed - 4}`)
  assertEquals(pressed, { open: true, expanded: 'true' })
  assertEquals(again, { open: false, expanded: 'false' })
  assertEquals(escaped, { open: false, expanded: 'false' })
  assertEquals(outside, { open: false, expanded: 'false' })
  assertEquals(heard.open, true)
  assertStringIncludes(heard.label!, '2 failed')
})

test('a page reads its draft only as it opens and as its socket opens, never on a timer', async () => {
  let page = await load(storage(), false, 'new', {}, undefined, 'down')
  let status = page.document.querySelector('[data-send-status]')!
  // ask's five tries, until the page says they failed, then a hundred
  // seconds more, sped up
  let tried = async () => {
    await until(() => page.status() != '')
    await new Promise((ok) => setTimeout(ok, 100))
    return page.asked()
  }
  let alone = await tried()
  status.textContent = ''
  page.open()
  let opened = await tried()
  page.leave()
  assertEquals([alone, opened], [5, 10])
})

// Last, since it sends a message to the road conversation.
test('words said to the chat are its draft as they are heard, and once sent, what each step lands is said back', async () => {
  let t = speaking = talker()
  let page = await load(storage(), false, road, apps)
  speaking = undefined
  await page.heard()
  let task = page.document.querySelector('[data-task]')!.getAttribute(
    'data-task',
  )!
  let mic = page.document.querySelector('[data-voice]')!
  assertEquals(mic.hasAttribute('hidden'), false)
  page.press(mic)
  // what is heard follows what the box held
  t.says('and the agenda')
  await settle()
  assertEquals(
    await stored('operator:' + road),
    'Add the hearing date and the agenda',
  )
  t.stops()
  await settle()
  page.hear({
    operator: {
      task,
      rows: [],
      now: '',
      said: ['Released notes', 'Done. The date is on it.'],
    },
  })
  assertEquals(t.spoken, ['Released notes', 'Done. The date is on it.'])
  page.leave()
})

// A refresh keeps the range this page opened with even after enough new
// steps would move the latest-entry window past its oldest words.
let growingStore = operatorStore(p.states.get(`builder ${eid}`)!.storage)
let growing = crypto.randomUUID()
let oldWords = ['Book the pavilion', 'And the north shelter']
let growingEntry = (text: string, output = false) => ({
  entity: { eid: crypto.randomUUID() },
  entry: { session: growing },
  content: { body: text },
  ...output ? { output: {} } : {},
})
await growingStore.g.apply([
  {
    entity: { eid: growing },
    session: {},
    operator_session: { space: eid, person },
  },
  ...Array.from(
    { length: 5 },
    (_, i) => growingEntry(`Earlier step ${i}`, true),
  ),
  ...oldWords.map((text) => growingEntry(text)),
  ...Array.from({ length: 298 }, (_, i) => growingEntry(`Step ${i}`, true)),
], { trusted: true })

test(
  'a growing conversation keeps its oldest displayed words in order across refresh and reconnect',
  async () => {
    let page = await load(storage(), false, growing)
    let reported: string[] = []
    let was = globalThis.reportError
    globalThis.reportError = (e: unknown) => void reported.push(String(e))
    let words = () =>
      [...page.document.querySelectorAll('.Transcript_Bubble')]
        .map((r) => r.textContent)
    try {
      await growingStore.g.apply([
        ...Array.from(
          { length: 20 },
          (_, i) => growingEntry(`Later step ${i}`, true),
        ),
        growingEntry('The newest request'),
      ], { trusted: true })
      page.hear({ ready: true, standing: 'changed' })
      await until(() => words().includes('The newest request'))
      assertEquals(words(), [...oldWords, 'The newest request'])
      page.hear({ ready: true, standing: 'reconnected' })
      await until(() => page.talks() == 2)
      await settle()
      assertEquals(words(), [...oldWords, 'The newest request'])
      assertEquals(reported, [])
    } finally {
      globalThis.reportError = was
      page.leave()
    }
  },
  { tags: ['window'] },
)

test('entry actions copy the source and its link, quote into the existing composer and save the draft', async () => {
  let entryActions = await load(storage(), false, park)
  await entryActions.heard()
  entryActions.type('Keep this draft')
  let actionTrigger = entryActions.document.querySelector<HTMLElement>(
    '[data-menu-trigger]',
  )!
  let actionMenu = entryActions.document.getElementById(
    actionTrigger.dataset.menuTrigger!,
  )!
  let copiedText = actionMenu.getAttribute('data-entry-text')!
  entryActions.press(actionTrigger)
  entryActions.press(actionMenu.querySelector('[data-entry-copy]')!)
  await settle()
  entryActions.press(actionTrigger)
  entryActions.press(actionMenu.querySelector('[data-entry-link]')!)
  await settle()
  entryActions.press(actionTrigger)
  entryActions.press(actionMenu.querySelector('[data-entry-quote]')!)
  await settle()
  let quotedDraft = entryActions.say.value
  entryActions.leave()
  let quotedAgain = await load(storage(), false, park)
  await quotedAgain.heard()
  let quoteAfterReload = quotedAgain.say.value
  quotedAgain.leave()

  assertEquals(entryActions.copied[0], copiedText)
  assertStringIncludes(entryActions.copied[1], '/' + park + '#row-')
  let copiedLink = new URL(entryActions.copied[1])
  let linkedPage = parseHTML(
    await (await chatPage(
      p.env,
      space,
      who,
      copiedLink.pathname.split('/').at(-1)!,
    )).text(),
  ).document
  assert(!!linkedPage.getElementById(copiedLink.hash.slice(1)))
  assertEquals(actionMenu.hidden, true)
  assertStringIncludes(quotedDraft, 'Keep this draft\n\n> [Quoted entry](')
  assertStringIncludes(
    quotedDraft,
    copiedText.split('\n').map((line) => '> ' + line).join('\n'),
  )
  assertEquals(quoteAfterReload, quotedDraft)
})
