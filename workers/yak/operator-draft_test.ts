// The Operator chat app's own script, run over linkedom with its fetches answered
// by operatorAnswer, loaded again and again over one localStorage: what a
// person typed is kept when the page is left with its save cut off. And the
// app beside the chat, drawn again as the Operator works on it, which a
// page opens as their Operator starts making it.

import { cleanup, test, tick, until } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import * as yaml from 'yaml'
import type { Stash } from '@yaks/draft'
import { directoryOf } from './directory.ts'
import { platform } from './testing.ts'
import {
  type Beside,
  chatPage,
  operatorAnswer,
  storeAnswer,
} from './operator-page.ts'
import { type StoreDoor } from '@yaks/platform/routes'
import { REACH } from '@yaks/platform/page-graph'
import { talkAsked, talkRow, type Told } from '@yaks/platform/operator-talk'
import {
  installPair,
  made as pairs,
  type Pair,
} from '../../packages/workerd/testing.ts'
import { reachDoor } from './reach-door.ts'
import type { Frame } from '@yaks/api'
import { clock } from './timing.ts'
import type { Wire } from '@yaks/durable-object'
import type { Who } from './session.ts'
import { pageModule } from './page-module-probe.ts'
import { sourceModules } from './page-source-probe.ts'
import { operatorVocab } from './operator-store.ts'
import { pageDocs } from './operator-words.ts'
import { released, talking } from './operator-testing.ts'
import { openedOf, operatorFrames } from './operator-host.ts'
import { operatorStore } from './operator-store.ts'
import { inputOf } from '@yaks/session'
import { LEAVE, sources, stays, swap } from '@yaks/ui/navigate'
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
// The lines the page graph watches the person's drafts and conversation in a
// space on.
let DRAFTS = '.operatorDraft.space='
let TALK = '.operatorTalk.space='
// What the kernel answers the page at its address: the tab's page graph's
// door (reach-door.ts), a door of its store (operator-api.ts), or the
// Operator's own.
let serve = async (url: string | URL, init?: RequestInit, as: Who = who) => {
  let req = new Request(new URL(url, base), init)
  let { pathname } = new URL(req.url)
  if (pathname.startsWith(REACH)) {
    return await reachDoor(req, p.env, directoryOf(p.env.STORE), as, clock())
  }
  let door = /\/operator\/(apply|query|ws)$/.exec(pathname)
  return door
    ? await storeAnswer(req, p.env, space, as, door[1] as StoreDoor)
    : (await operatorAnswer(req, p.env, space, as))!
}

// The runtime's socket pairs, for the page graph's socket and the sockets
// its door opens onto the Builder object (reach.ts `watching`), each Builder
// socket carried to the object as the runtime carries it.
installPair()
let linked = new Set<Pair>()
let builders = p.env.BUILDER
p.env.BUILDER = {
  idFromName: builders.idFromName,
  get: (id, options) => ({
    fetch: async (req: Request) => {
      let res = await builders.get(id, options).fetch(req)
      let accepted = p.sockets.get(`builder ${id}`) ?? []
      let pair = pairs.findLast((pair) =>
        !linked.has(pair) && accepted.includes(pair[1] as unknown as Wire)
      )
      if (res.status != 101 || !pair) return res
      linked.add(pair)
      let [client, server] = [pair[0], pair[1]]
      let object = p.builder(String(id))
      client.send = (data) => void object.webSocketMessage(server, data)
      // What the object says reaches the client half once it is accepted,
      // as the runtime holds a socket's messages until then: first what the
      // object said as it took the socket.
      let held: string[] | undefined = server.taken().map((f) =>
        JSON.stringify(f)
      )
      server.send = (data) =>
        held ? void held.push(data) : client.emit('message', data)
      let accept = client.accept.bind(client)
      client.accept = () => {
        accept()
        queueMicrotask(() => {
          for (let data of held?.splice(0) ?? []) client.emit('message', data)
          held = undefined
        })
      }
      client.close = () => {
        if (client.readyState == 3) return
        client.readyState = server.readyState = 3
        void object.webSocketClose(server)
        client.emit('close')
      }
      server.close = () => {
        if (server.readyState == 3) return
        server.readyState = 3
        client.readyState = 3
        client.emit('close')
      }
      return Object.assign(res, { webSocket: client, pair })
    },
  }),
} as typeof builders

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
// `network` 'held' leaves the first handshake of its store's socket (where its
// drafts are read) and of its Operator's socket unanswered, as a network can,
// until the page gives each up; 'deploying' answers the first read of each
// address 502, and the store's first handshake as failed, as the edge does
// while a deploy replaces the Worker; 'down' fails every handshake of the
// store's socket. 'held' and 'down' give the page a clock the test holds: its
// time passes only by `pass`. Under the others, the page's waits run a
// thousand times faster.
let scripts = sourceModules(base, {
  yaml,
  '/follow.js': new URL('./public/follow.js', import.meta.url),
  '/frames.js': new URL('./public/frames.js', import.meta.url),
  '/voice.js': new URL('./public/voice.js', import.meta.url),
  '/_talk.js': new URL('./operator-rows.ts', import.meta.url),
  '/_words.js': { default: pageDocs(operatorVocab.docs) },
})

// Timers from the client and its socket and presence code belong to the tab.
let fromTab = () =>
  /\/packages\/(client\/|notify\/tab\.ts|sync\/(socket|sync)\.ts)/.test(
    new Error().stack ?? '',
  )

// A tab: its page graph, kept on the tab's global as @yaks/client `shared`
// keeps it, the page graph's sockets, and how many frames they have heard.
type Tab = {
  graphs: Map<string, { close: () => void }>
  stores: { readyState: number; close: () => void; sent: string[] }[]
  /** the frames answering its drafts subscriptions */
  frames: number
  /** the subscriptions its page graph holds open, by id */
  live: Map<string, string>
  /** the drafts packets sent it, not yet taken in */
  acks: Set<string>
  /** each conversation subscription's answer and steps as the page holds
   * them, by id */
  talks: Map<
    string,
    {
      opened: string
      n: number
      typing?: string
      seq?: number
      writing?: boolean
    }
  >
  /** every conversation row it was sent, as the page took it */
  told: Told[]
}
type View = Pick<ReturnType<typeof parseHTML>, 'document'> & {
  windowEvents: EventTarget
  tab: Tab
}
// linkedom supports once but needs the browser's removal on abort.
let bound = new WeakSet<EventTarget>()
let signals = (target: EventTarget) => {
  if (bound.has(target)) return
  bound.add(target)
  let add = target.addEventListener.bind(target)
  target.addEventListener = (type, listener, options) => {
    let signal = typeof options == 'object' && options.signal
    if (signal && signal.aborted) return
    add(type, listener, options)
    if (signal) {
      signal.addEventListener('abort', () => {
        target.removeEventListener(type, listener, options)
      }, { once: true })
    }
  }
}

let load = async (
  stash: Stash,
  cut = false,
  open = 'new',
  beside: Beside = {},
  app?: string,
  network?: 'held' | 'deploying' | 'down',
  as: Who = who,
  { view, holdTimers = false }: { view?: View; holdTimers?: boolean } = {},
) => {
  let html = await (await chatPage(p.env, space, as, open, beside, app))
    .text()
  let { document: next, Event, CustomEvent, HTMLIFrameElement } = parseHTML(
    html,
  )
  // The side drawn live from the tab's page graph is reach-door_test.ts's:
  // here the page holds its conversation alone.
  next.querySelector('[data-side-view]')?.removeAttribute('data-side-view')
  let { document, windowEvents, tab } = view ?? {
    document: next,
    windowEvents: next.createElement('div'),
    tab: {
      graphs: new Map(),
      stores: [],
      frames: 0,
      live: new Map(),
      acks: new Set(),
      talks: new Map(),
      told: [],
    } as Tab,
  }
  // The frames the tab's page graph heard before this page: one after them
  // answers this page's drafts.
  let before = tab.frames
  if (view) {
    let doc = document as unknown as Document
    swap(doc, next as unknown as Document, sources(doc, base), () => {}, base)
  }
  signals(document)
  signals(windowEvents)
  document.hasFocus = () => true
  Object.defineProperty(document, 'oninput', {
    value: null,
    configurable: true,
  })
  Object.defineProperty(document, 'visibilityState', { value: 'visible' })
  for (
    let part of document.querySelectorAll(
      '#content, #entry-menu, #ask, [data-voice]',
    )
  ) {
    signals(part)
  }
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
      configurable: true,
      value: new Proxy({}, { get: (_, name) => named(String(name)) }),
    })
    Object.defineProperty(form, 'action', {
      configurable: true,
      value: form.getAttribute('action'),
    })
    Object.defineProperty(form, 'requestSubmit', {
      configurable: true,
      value: () =>
        form.dispatchEvent(
          new Event('submit', { bubbles: true, cancelable: true }),
        ),
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
  let timers = new Map<number, ReturnType<typeof setTimeout>>()
  // The tab's graph timers and the renderer's after-paint callbacks can
  // outlive an individual page.
  let tabTimers = new Set<number>()
  // The page's waits on the held clock: each runs once `pass` reaches its
  // moment, `now`, which the page reads as `performance.now()`.
  let held = holdTimers || network == 'held' || network == 'down'
  let now = 0, n = 0
  let waits = new Map<number, { at: number; fn: () => void }>()
  let after = (fn: () => void, ms: number) => {
    if (left) return 0
    let id = ++n
    if (fromTab() || /\/page-renderer\.js/.test(new Error().stack ?? '')) {
      tabTimers.add(id)
    }
    if (held) waits.set(id, { at: now + ms, fn })
    else {
      timers.set(
        id,
        setTimeout(
          () => (timers.delete(id), fn()),
          network || ms < 1000 ? ms / 1000 : ms,
        ),
      )
    }
    return id
  }
  let cancel = (id: number) => {
    if (held) waits.delete(id)
    else {
      clearTimeout(timers.get(id))
      timers.delete(id)
    }
  }
  let intervals = new Set<number>()
  // The page's beats: the tab's page graph's outlive it, and are not its.
  let every = () => {
    ++n
    if (!fromTab()) intervals.add(n)
    return n
  }
  // Lets `ms` of the held clock pass, the page's waits running in the order
  // they fall due, each once what the last set going has landed; or less, once
  // `done`, which it answers.
  let pass = async (ms: number, done = () => false) => {
    let end = now + ms
    for (;;) {
      await tick()
      if (done()) return true
      let [id, wait] = [...waits].sort(([, a], [, b]) => a.at - b.at)[0] ?? []
      if (!wait || wait.at > end) break
      waits.delete(id!)
      now = wait.at
      wait.fn()
    }
    now = end
    return done()
  }
  // The reads of its drafts the page asked by any way but its page graph,
  // and the page graph's handshakes it tried over HTTP first.
  let asked = 0, probes = 0
  let down = network == 'down'
  let failed = new Set<string>()
  // Each read of the conversation.
  let talks = 0, received = 0
  let conversation = (answer: Response) => {
    let json = answer.json.bind(answer)
    answer.json = async () => {
      let value = await json()
      received++
      return value
    }
    return answer
  }
  let fetch = async (input: string | URL | Request, init?: RequestInit) => {
    let url = input instanceof Request ? input.url : String(input)
    if (input instanceof Request) init ??= input
    let door = /\/(operator|reach)\/(ws|query|apply)$/.exec(
      new URL(url, base).pathname,
    )
    if (door?.[2] == 'ws') probes++
    if (door && down) throw new TypeError('Network unreachable')
    if (url.includes('?talk=') && slow) {
      let answer = await serve(url, init, as)
      talks++
      await slow
      if (left) return new Promise<Response>(() => {})
      return conversation(answer)
    }
    if (cut && init?.method == 'POST') return new Promise<Response>(() => {})
    if (init?.method == 'POST') posted.push(url)
    let delayed = door?.[1] == 'reach' && door[2] == 'apply' && delayDraft
    if (delayed) {
      delayed.started = true
      await delayed.release.promise
    }
    if (refused && init?.method == 'POST' && new URL(url, base).href == base) {
      return new Response('Bad Gateway', { status: 502 })
    }
    if (/draft=1|\/query/.test(url)) asked++
    if (url.includes('?talk=')) talks++, await late
    if (network == 'deploying' && !init?.method && !failed.has(url)) {
      failed.add(url)
      return new Response('Bad Gateway', { status: 502 })
    }
    let answer = await serve(url, init, as)
    if (delayed) delayed.landed = answer
    if (init?.body instanceof FormData && delayDraft) {
      delayDraft.sent = answer.clone()
    }
    if (left) return new Promise<Response>(() => {})
    return url.includes('?talk=') ? conversation(answer) : answer
  }
  // linkedom keeps no focus or selection: the box records being given it.
  let say = document.querySelector('#ask [name=say]') as HTMLTextAreaElement
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
  // Any socket the page opens of its own, which it should not, and the tab's
  // page graph's sockets, carried to its door as they open (`reach`).
  let sockets: Page[] = [], stores = tab.stores
  // The open conversation subscription the Operator answered, if any.
  let talking = () =>
    [...tab.live].findLast(([id, q]) => q.startsWith(TALK) && tab.talks.has(id))
      ?.[0]
  let handshakes = 0
  let reach = async (page: Page) => {
    handshakes++
    // Its address says more each time it opens again: the first to its door
    // is the one a deploy fails.
    let at = new URL(page.url).pathname
    let refused = down ||
      network == 'deploying' && !failed.has(at) && !!failed.add(at)
    if (network == 'held' && handshakes == 1) return
    if (refused) return page.emit('close')
    let res = await serve(page.url, { headers: { upgrade: 'websocket' } }, as)
    // The door's half: the pair it accepted, which nothing has carried yet.
    let pair = pairs.findLast((pair) => pair[1].accepted && !linked.has(pair))
    if (res.status != 101 || !pair) return page.emit('close')
    linked.add(pair)
    let door = pair[1]
    door.send = (data) => {
      if (page.readyState != 1) return
      let packet = JSON.parse(data) as
        | Frame
        | { frames: Frame[]; ack?: string }
      let frames = 'frames' in packet ? packet.frames : [packet]
      let drafts = frames.some((f) =>
        !f.refused && tab.live.get(f.id)?.startsWith(DRAFTS)
      )
      // Heard once the page has taken it in, which it says by acking it.
      if (drafts && packet.ack) tab.acks.add(packet.ack)
      // The Operator's conversation rows, numbered with what a test says for
      // it (`hear`), as one sequence.
      for (let f of frames) {
        if (!tab.live.get(f.id)?.startsWith(TALK)) continue
        for (let b of f.bundles ?? []) {
          let told = b.operatorTalk as Told | undefined
          if (!told) continue
          if (f.reset) tab.talks.set(f.id, { opened: told.opened, n: told.n })
          let held = tab.talks.get(f.id)!
          told.opened = held.opened
          told.n = told.step ? ++held.n : held.n
          tab.told.push(told)
        }
      }
      page.emit('message', { data: JSON.stringify(packet) })
    }
    if (page.readyState != 0) return door.emit('close')
    page.door = door
    page.send = (data) => {
      page.sent.push(data)
      let said = JSON.parse(data) as {
        subscribe?: string
        unsubscribe?: string
        id?: string
        ack?: string
      }
      if (typeof said.subscribe == 'string') {
        tab.live.set(said.id!, said.subscribe)
      }
      if (said.unsubscribe) tab.live.delete(said.unsubscribe)
      if (said.ack && tab.acks.delete(said.ack)) tab.frames++
      door.emit('message', data)
    }
    page.emit('open')
  }
  class Page {
    readyState = 0
    door?: Pair[1]
    onopen?: () => void
    onmessage?: (e: { data: string }) => void
    onclose?: () => void
    sent: string[] = []
    #heard: Record<string, ((e: unknown) => void)[]> = {}
    constructor(public url: string) {
      if (new URL(url).pathname != `${REACH}/ws`) sockets.push(this)
      else stores.push(this), queueMicrotask(() => void reach(this))
    }
    send(data: string) {
      this.sent.push(data)
    }
    addEventListener(type: string, fn: (e: unknown) => void) {
      ;(this.#heard[type] ??= []).push(fn)
    }
    emit(type: string, e: Record<string, unknown> = {}) {
      if (type == 'open') this.readyState = 1
      if (type == 'close') this.readyState = 3
      let on = {
        open: this.onopen,
        message: this.onmessage,
        close: this.onclose,
      }
      ;(on[type as keyof typeof on] as ((e: unknown) => void) | undefined)?.(e)
      for (let fn of this.#heard[type] ?? []) fn(e)
    }
    close() {
      if (this.readyState == 3) return
      this.readyState = 3
      this.door?.emit('close')
      queueMicrotask(() => this.emit('close'))
    }
  }
  let source = document.querySelector('script[data-operator-chat]')!
    .textContent!
  // Where the page went by its address (`location.assign`).
  let went: string[] = []
  let place = {
    reload: () => void loads.page++,
    assign: (to: URL | string) => void went.push(String(to)),
    origin: 'https://yaks.app',
    href: base + '/' + open,
  }
  let copied: string[] = []
  let leave = () => {
    if (left) return
    document.dispatchEvent(new Event(LEAVE))
    left = true
  }
  cleanup(() => {
    leave()
    for (let t of timers.values()) clearTimeout(t)
    waits.clear()
    // The tab is closed: its page graph goes with it.
    for (let graph of [...tab.graphs.values()]) graph.close()
  })
  // The browser's interfaces belong to this load, including those used inside
  // imported modules: storage, speech, timers and the page's socket.
  let marks = new Map<string, { name: string; startTime: number }>()
  await pageModule(source, {
    at: base,
    ...scripts,
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
      setInterval: every,
      clearInterval: (id: number) => void intervals.delete(id),
      setTimeout: after,
      clearTimeout: cancel,
      ...held
        ? {
          performance: {
            now: () => now,
            mark: (name: string) => marks.set(name, { name, startTime: now }),
            getEntriesByName: (name: string) =>
              marks.has(name) ? [marks.get(name)] : [],
          },
        }
        : {},
      FormData: FormOf,
      DataTransfer: class {
        files: File[] = []
        items = { add: (file: File) => this.files.push(file) }
      },
      Event,
      CustomEvent,
      HTMLIFrameElement,
      scrollTo: () => {},
      addEventListener: windowEvents.addEventListener.bind(windowEvents),
      removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
      dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
      ...speaking
        ? {
          SpeechRecognition: speaking.platform(Event).Recognition,
          speechSynthesis: speaking.platform(Event).synthesis,
          SpeechSynthesisUtterance: speaking.platform(Event).Utterance,
        }
        : {},
      WebSocket: Page,
      [Symbol.for('@yaks/client/shared')]: tab.graphs,
    },
  })
  return {
    say,
    focused,
    copied,
    loads,
    document,
    view: { document, windowEvents, tab },
    focus: () => windowEvents.dispatchEvent(new Event('focus')),
    sockets,
    stores,
    intervals,
    // The page's own waits: the tab's page graph's outlive it.
    timeouts: () =>
      [...timers.keys(), ...waits.keys()].filter((id) => !tabTimers.has(id))
        .length,
    // What the page says under its box.
    status: () => document.querySelector('#ask .Composer_Status')!.textContent,
    went,
    failed,
    asked: () => asked,
    // The handshakes its store's sockets made.
    handshakes: () => handshakes,
    probes: () => probes,
    recover: () => void (down = false),
    disconnect: () => {
      down = true
      for (let socket of stores) socket.close()
    },
    pass,
    talks: () => talks,
    received: async () => {
      await until(() => received == talks)
      await tick()
    },
    // Once the Operator answered the page's conversation, through its page
    // graph: what a test says for it (`hear`) comes after.
    answered: () =>
      until(() => talking() != undefined, { label: 'its answer' }),
    // A frame the Operator says of the page's conversation, on its page
    // graph's socket as the door carries it, once the page took it in: a
    // step's (`{operator}`), its watch answered whole again
    // (`{ready, standing}`, with no row when `gone`), and words of a reply
    // written in the conversation `writing` (`{typing}`, the words so far
    // when it is answered whole).
    hear: async (frame: {
      operator?: object
      ready?: true
      standing?: string
      gone?: true
      typing?: string
      writing?: string
    }) => {
      let id = await until(() => talking(), { label: 'its answer' })
      let held = tab.talks.get(id)!
      let page = stores.findLast((s) => s.readyState == 1) as Page
      let talk = talkAsked(tab.live.get(id)!)!
      if (frame.ready) {
        held.opened = crypto.randomUUID(), held.n = 0, held.writing = false
      }
      let row = talkRow(as.person!, talk, {
        opened: held.opened,
        n: frame.operator ? ++held.n : held.n,
        ...frame.standing == null ? {} : { standing: frame.standing },
        ...frame.operator ? { step: frame.operator as Told['step'] } : {},
        ...frame.writing ? { writing: frame.writing } : {},
      })
      // A reply's words, said whole as it begins and each after on the
      // last; a step ends it.
      let typed = []
      let to = (op: string, text?: string) => ({
        id: held.typing!,
        entity: row.entity.eid,
        component: 'operatorTalk',
        property: 'typing',
        seq: held.seq = op == 'begin' ? 0 : held.seq! + 1,
        op,
        ...text == null ? {} : { text },
      })
      if (frame.operator && held.writing) {
        typed.push(to('end'))
        held.writing = false
      }
      if (frame.typing != null) {
        if (!held.writing) held.typing = crypto.randomUUID()
        typed.push(to(held.writing ? 'append' : 'begin', frame.typing))
        held.writing = true
      }
      let ack = crypto.randomUUID()
      page.emit('message', {
        data: JSON.stringify({
          frames: [{
            id,
            ...frame.gone
              ? { bundles: [] }
              : frame.typing != null && !frame.writing
              ? {}
              : { bundles: [row] },
            ...frame.ready
              ? { reset: true, transientReset: [row.entity.eid] }
              : {},
            ...typed.length ? { transient: typed } : {},
          }],
          ack,
        }),
      })
      await until(() => page.sent.some((d) => d.includes(ack)), {
        label: 'the page took it in',
      })
    },
    // Where the page's conversation stood as the server drew it.
    standing: () =>
      JSON.parse(
        /let standing = ([^\n]*)/.exec(source)?.[1] ?? 'null',
      ) as string | null,
    press: (button: Element) =>
      button.dispatchEvent(new Event('click', { bubbles: true })),
    // A key pressed on the page.
    key: (key: string) =>
      document.dispatchEvent(
        Object.assign(new Event('keydown', { bubbles: true }), { key }),
      ),
    // Whether the page has heard the store's drafts.
    read: () => tab.frames > before,
    // How many drafts subscriptions the tab's page graph holds open.
    drafting: () =>
      [...tab.live.values()].filter((q) => q.startsWith(DRAFTS)).length,
    // The conversation rows its page graph was sent.
    told: () => tab.told,
    // How many conversation subscriptions it holds open.
    conversing: () =>
      [...tab.live.values()].filter((q) => q.startsWith(TALK)).length,
    // Once the page has heard the store's drafts.
    heard: async () => {
      await until(() => tab.frames > before, { label: 'the store’s draft' })
    },
    type: (text: string) => {
      say.value = text
      say.dispatchEvent(new Event('input', { bubbles: true }))
    },
    enter: () =>
      say.dispatchEvent(
        Object.assign(new Event('keydown', { bubbles: true }), {
          key: 'Enter',
        }),
      ),
    send: () => {
      let form = document.querySelector('#ask')!
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
    },
    leave,
  }
}
// While set, a read of the conversation is answered as the store stood when
// it was asked, but reaches the page only once this settles.
let slow: Promise<void> | undefined
// While set, a read of the conversation is asked of the store only once this
// settles.
let late: Promise<void> | undefined
// While set, the page's door refuses what is sent to it; and every address
// a page posted to, in order.
let refused = false
let posted: string[] = []
let delayDraft: {
  started?: boolean
  release: PromiseWithResolvers<void>
  landed?: Response
  sent?: Response
} | undefined
let stored = async (place = 'operator:new') =>
  ((await (await serve(`${base}/query?q=.draft`)).json()) as {
    draft: { place: string; text: string }
  }[]).find((b) => b.draft.place == place)?.draft.text ?? ''

// The side's apps as the directory holds them: Notes released.
let notes = (await directoryOf(p.env.STORE).apps(space))
  .find((a) => a.slug == 'notes')!
let apps = {
  apps: [
    { eid: notes.eid, slug: 'notes', title: 'Notes', source: notes.source },
    { eid: 'club', slug: 'club', title: 'Club' },
  ],
}
// Before the person has written, the space's address is a new chat, with ways
// to start.
let starting = await load(storage(), false, 'new', apps)

let stash = storage()
let first = await load(stash, true)
await first.heard()
first.type('Post the road millage notice')
let unsaved = await stored()
first.leave()

let second = await load(stash)
await second.heard()
let shown = second.say.value
let saved = await until(async () => await stored() || undefined)
second.type('Post the road millage notice by Friday')
await until(async () =>
  await stored() == 'Post the road millage notice by Friday'
)
second.leave()

let third = await load(stash, true)
await third.heard()
third.type('Post the road millage notice by Friday, with the agenda')
third.send()
await until(() => third.say.value == '')
let sending = third.say.value
third.leave()

let fourth = await load(stash)
await fourth.heard()
let resent = fourth.say.value
let afterSend = await until(async () => {
  let text = await stored()
  return text == resent && text
})
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

// A store's socket and an Operator's socket the network never answers are
// given up and opened again, so the draft still arrives and the Operator's
// socket opens anew.
let hold = storage()
let typed = await load(hold)
await typed.heard()
typed.type('Order salt for the township garage')
await until(async () => await stored() == 'Order salt for the township garage')
typed.leave()
let waited = await load(storage(), false, 'new', {}, undefined, 'held')
await waited.pass(60_000, () => waited.read() && waited.stores.length > 1)
waited.leave()

test("the Operator's chat app reads its draft again when its page graph's socket is never answered", () => {
  assertEquals(waited.say.value, 'Order salt for the township garage')
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

test('swapping between conversations and leaving for Manage lets go of each chat', async () => {
  let stash = storage()
  // Leave with timers still pending, regardless of when the runner would
  // have fired them. The renderer's after-paint callbacks belong to the tab.
  let visit = (chat: string, view?: View) =>
    load(stash, false, chat, {}, undefined, undefined, who, {
      view,
      holdTimers: true,
    })
  let first = await visit(road)
  let doc = first.document as unknown as Document
  let menu = doc.getElementById('menu')
  await first.heard()
  assert(!stays(doc), 'the navigator can leave the conversation in place')
  first.leave()
  // The tab's page graph stays open, holding no page's drafts or
  // conversation, and the page opened no socket of its own.
  assertEquals([first.sockets.length, first.conversing()], [0, 0])
  assertEquals(first.drafting(), 0)
  assertEquals(first.intervals.size, 0)
  assertEquals(first.timeouts(), 0)
  assert(!doc.querySelector('#ask'))
  // Its lines stay standing, let go of, for the page laid over next to keep
  // (operator-talk-browser.ts `close`).
  assertEquals(doc.querySelectorAll('[data-task]').length, 1)

  let second = await visit(park, first.view)
  await second.heard()
  assertEquals([second.sockets.length, second.conversing()], [0, 1])
  assertEquals(second.stores.length, 1)
  assertEquals(second.intervals.size, 1)
  assertEquals(doc.querySelectorAll('#ask').length, 1)
  assert(doc.getElementById('menu') == menu)
  assertStringIncludes(
    doc.querySelector('[data-conversation]')!.textContent!,
    'Book the park pavilion',
  )
  assertEquals(doc.querySelectorAll('[data-task]').length, 1)

  // Where the tab is goes on its page graph's socket.
  let tabs = () =>
    second.stores.flatMap((s) => s.sent).filter((d) => 'tab' in JSON.parse(d))
      .length
  let before = tabs()
  second.focus()
  assertEquals(tabs(), before + 1)
  let trigger = doc.querySelector('[data-menu-trigger]')!
  second.press(trigger)
  second.press(doc.querySelector('[data-entry-copy]')!)
  assertEquals(second.copied, [trigger.getAttribute('data-entry-text')])
  assertEquals(first.copied, [])

  second.leave()
  let manage = parseHTML(
    '<html><head><script data-navigate src="/_navigate.js"></script></head><body><main>Manage</main></body></html>',
  ).document
  swap(doc, manage as unknown as Document, sources(doc, base), () => {}, base)
  assertEquals(doc.querySelector('main')?.textContent, 'Manage')
  assertEquals([second.sockets.length, second.conversing()], [0, 0])
  assertEquals(second.drafting(), 0)
  assertEquals(second.intervals.size, 0)
  assertEquals(second.timeouts(), 0)

  let back = await visit(road, second.view)
  await back.heard()
  assertEquals([back.sockets.length, back.conversing()], [0, 1])
  assertEquals(back.stores.length, 1)
  assertStringIncludes(
    doc.querySelector('[data-conversation]')!.textContent!,
    'Post the road millage notice',
  )
  back.leave()
})

test('a tab watching its conversation is where its person is on that Operator, until it is left', async () => {
  let { seen } = await import('./whereabouts.ts')
  // Someone of their own, so no other test's tab of theirs is open.
  let cy = crypto.randomUUID()
  await directoryOf(p.env.STORE).apply({
    entities: [
      { entity: { eid: cy }, person: {} },
      {
        entity: { eid: crypto.randomUUID() },
        member: { person: cy, space: eid, role: 'editor' },
      },
    ],
  }, { 'x-yak-person': person, 'x-yak-role': 'owner' })
  let tab = async () => (await seen(p.env, cy, eid))?.tab
  let page = await load(storage(), false, 'new', {}, undefined, undefined, {
    person: cy,
    role: 'editor',
    space: eid,
  } as Who)
  await page.heard()
  page.focus()
  await until(async () => await tab() == 'here', { label: 'here' })
  page.leave()
  await until(async () => await tab() == undefined, { label: 'gone' })
})

let onRoad = await load(stash, false, road)
await onRoad.heard()
let roadFocused = onRoad.focused
onRoad.type('Add the hearing date')
await until(async () =>
  await stored('operator:' + road) == 'Add the hearing date'
)
onRoad.leave()

let onPark = await load(stash, false, park)
await onPark.heard()
let parkShown = onPark.say.value
onPark.type('Ask for the north shelter')
await until(async () =>
  await stored('operator:' + park) == 'Ask for the north shelter'
)
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

test('words sent show at once; those the door does not take come off and are back in the box, and it says so', async () => {
  let page = await load(storage(), false, park)
  await page.heard()
  let said = () =>
    [...page.document.querySelectorAll('.Transcript_Bubble')]
      .filter((b) => b.textContent == 'Ask for the pavilion keys').length
  page.type('Ask for the pavilion keys')
  refused = true
  try {
    page.send()
    assertEquals(said(), 1)
    await until(() => page.status().includes('back in the box'))
  } finally {
    refused = false
  }
  assertEquals([said(), page.say.value], [0, 'Ask for the pavilion keys'])
  assertStringIncludes(page.status(), 'Your message was not sent')
  page.leave()
})

test('sending before the draft save lands spends the words in every tab', async () => {
  let stash = storage()
  let here = await load(stash, false, park)
  let there = await load(storage(), false, park)
  await Promise.all([here.heard(), there.heard()])
  try {
    let delayed: NonNullable<typeof delayDraft> = delayDraft = {
      release: Promise.withResolvers<void>(),
    }
    here.type('Ask about the park entrance')
    await until(() => delayed.started, { label: 'an in-flight autosave' })
    here.type('Ask about the park entrance and parking')
    here.enter()
    let sent = await until(() => delayed.sent, { label: 'the message receipt' })
    assertEquals(sent.status, 200)
    await until(() => !here.status().includes('Sending'))
    delayed.release.resolve()
    let landed = await until(() => delayed.landed, {
      label: 'the late autosave receipt',
    })
    assertEquals(landed.status, 200)
    let reloaded = await load(stash, false, park)
    await reloaded.heard()
    assertEquals(
      [
        await stored('operator:' + park),
        here.say.value,
        there.say.value,
        reloaded.say.value,
      ],
      ['', '', '', ''],
      here.status(),
    )
    let { request } = await sent.json() as { request: string }
    let query = new URLSearchParams({ q: `.entity.eid=${request}&*` })
    let [row] = await (await serve(`${base}/query?${query}`)).json()
    assertEquals(row?.doc.body, 'Ask about the park entrance and parking')
    reloaded.leave()
  } finally {
    delayDraft?.release.resolve()
    delayDraft = undefined
    here.leave()
    there.leave()
  }
})

test('Stop in the box stops the conversation it shows', async () => {
  let page = await load(storage(), false, park)
  await page.heard()
  posted.length = 0
  page.press(page.document.querySelector('#ask .Composer_Stop')!)
  await until(() => posted.length)
  assertEquals(posted, [new URL(base).pathname + '?stop=1'])
  page.leave()
})

test('the app beside the chat loads again when the Operator changes it, and only then', async () => {
  let page = await load(storage(), false, 'new', apps, 'notes')
  await page.hear(changing('x', { space: '', app: 'club' }))
  await page.hear(changing('x', { space: 'mill', app: 'notes' }))
  await page.hear(changing('x', { space: 'clerk', app: 'notes' }))
  await page.hear(changing('x', { space: '', app: 'notes' }))
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
  await page.hear(changing(task, { space: '', app: 'club' }))
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

// What is open beside the chat is what its address names, and only that:
// the page goes to an app the Operator is making by its address, so a
// reload, Back or a shared link all agree with it.
test("a newcomer's chat goes to the app their Operator is making, by its address, and opens it there", async () => {
  let as = { person: newcomer, role: 'owner' as const }
  let page = await load(storage(), false, 'new', {}, undefined, undefined, as)
  assertEquals(page.document.querySelector('[data-app]'), null)
  await files(newcomer, 'recipes', ['vocab.json', {
    $defs: { recipe: { properties: { serves: { type: 'number' } } } },
  }])
  await page.hear(working({ space: '', app: 'recipes' }))
  assert(await until(() => page.went.length > 0))
  assertEquals(new URL(page.went[0]).searchParams.get('app'), 'recipes')
  assertEquals(page.document.querySelector('[data-app]'), null)
  page.leave()
  let apps = [{ eid: '', slug: 'recipes', title: 'Recipe box' }]
  let there = await load(
    storage(),
    false,
    'new',
    { apps },
    'recipes',
    undefined,
    as,
  )
  let { document } = there
  // What it is made of is the page graph's (operator-made_test.ts).
  assertEquals(
    document.querySelector('[data-app]')?.getAttribute('data-app'),
    'recipes',
  )
  assert(document.querySelector('.Talk')!.classList.contains('Talk-app'))
  there.leave()
})

test('a signed-in person’s chat goes to an app their Operator starts there, and not one it only works on', async () => {
  let page = await load(storage())
  await page.hear(working({ space: '', app: 'notes' }))
  await tick()
  assertEquals(page.went, [])
  let recipes = { space: '', app: 'recipes' }
  await page.hear({
    operator: { ...working(recipes).operator, started: [recipes] },
  })
  assert(await until(() => page.went.length > 0))
  assertEquals(new URL(page.went[0]).searchParams.get('app'), 'recipes')
  assertEquals(page.document.querySelector('[data-app]'), null)
  page.leave()
})

test('words typed on one page show on the person’s other open page as its socket brings them', async () => {
  let here = await load(storage(), false, park),
    there = await load(storage(), false, park)
  await Promise.all([here.heard(), there.heard()])
  here.type('Ask for the south shelter instead')
  let shown = await until(() =>
    there.say.value == 'Ask for the south shelter instead'
  )
  here.leave()
  there.leave()
  assertEquals(shown, true)
})

test('a page whose reads meet a deploy’s 502 reads again and catches up quietly', async () => {
  let page = await load(storage(), false, park, {}, undefined, 'deploying')
  let box = page.document.querySelector('[data-conversation]')!
  // where the conversation stands, moved by a line the page has not drawn
  await page.hear({ ready: true, standing: 'moved' })
  await page.heard()
  await until(() => page.talks() >= 2 && box.querySelector('[data-task]'))
  assertEquals(page.failed.size, 2, 'the draft and the conversation met it')
  assertEquals(page.talks(), 2, 'the conversation is read again')
  assertEquals(!!box.querySelector('[data-task]'), true)
  assertEquals(page.status(), '')
  page.leave()
})

// The page is served with the conversation drawn, and the Operator's answer
// to its watch of it reads it again only when a line landed between the two.
test('opening the chat app reads the conversation once, with the page', async () => {
  let page = await load(storage(), false, park)
  await page.answered()
  await tick()
  let still = page.talks()
  page.leave()
  // Its page graph's first handshake goes unanswered while a line lands.
  let landed = await load(storage(), false, park, {}, undefined, 'held')
  let box = landed.document.querySelector('[data-conversation]')!
  await begun('Ask for the north shelter as well')
  await landed.pass(60_000, () => landed.talks() > 0)
  await landed.received()
  assertEquals([still, landed.talks()], [0, 1])
  assertStringIncludes(box.innerHTML, 'Ask for the north shelter as well')
  landed.leave()
})

test('archive and restore while disconnected refresh the conversation once on reconnect', async () => {
  let store = await operatorStore(p.states.get(`builder ${eid}`)!.storage)
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
      await page.answered()
      let button = () =>
        page.document.querySelector(`[data-archive-entries="${id}"]`)
      await until(() =>
        button()?.getAttribute('data-restore') == String(archived)
      )
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
  let reading = async () =>
    (await (await serve(`${base}?talk=${park}`)).json()) as {
      html: string
      aside?: { turn: { what: string } | null }
    }
  let read = async () => (await reading()).html
  // Before it is taken in, the turn is under way wherever the page says so:
  // the line under the conversation, the yak beside the box, the aside.
  let before = await reading()
  let thread = parseHTML(before.html).document.querySelector('[data-task]')!
  assertEquals(
    [
      thread.querySelector('[data-now]')?.textContent,
      thread.getAttribute('data-doing'),
      before.aside?.turn?.what,
    ],
    ['Thinking…', 'thinking', 'Thinking…'],
  )
  let waiting = before.html
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
  await page.answered()
  await tick()
  let box = page.document.querySelector('[data-conversation]')!
  let release = () => {}
  slow = new Promise((ok) => release = ok)
  await page.hear({ ready: true, standing: 'moved' })
  await until(page.talks)
  slow = undefined
  await begun('Ask for the lakeside shelter too')
  let heard = await until(() =>
    box.innerHTML.includes('Ask for the lakeside shelter too')
  )
  release()
  await until(() => page.talks() >= 2)
  await page.received()
  assertEquals(
    [heard, box.innerHTML.includes('Ask for the lakeside shelter too')],
    [true, true],
  )
  page.leave()
})

// A read asked as the Operator's steps land answers them all: the steps
// heard while it was on its way are not read again.
test('a step heard while the page reads, and held in what the read answers, is read once', async () => {
  let page = await load(storage(), false, park)
  await page.answered()
  await tick()
  let box = page.document.querySelector('[data-conversation]')!
  let asked = Promise.withResolvers<void>()
  late = asked.promise
  await page.hear({ ready: true, standing: 'moved' })
  await until(page.talks)
  late = undefined
  await begun('Ask for the east shelter too')
  let heard = await until(() =>
    box.innerHTML.includes('Ask for the east shelter too')
  )
  asked.resolve()
  await page.received()
  await tick()
  assertEquals(
    [
      heard,
      page.talks(),
      box.innerHTML.includes('Ask for the east shelter too'),
    ],
    [true, 1, true],
  )
  page.leave()
})

// Words of the person the page showed are never taken off it by a read that
// leaves them out, and the tracker hears of it then; but words removed from
// the store (operator_remove) leave the page with them, and nobody hears.
test(
  'a read that leaves out words the page showed keeps their order and reports it, unless they were removed',
  async () => {
    let page = await load(storage(), false, park)
    await page.answered()
    await tick()
    let card = page.document.querySelector('[data-task]') as HTMLElement
    let ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    let words = ['Keep my first words', 'Keep my next words', 'Gone words']
    // The first two still stand in the store, outside the conversation; the
    // last was removed.
    let { g } = await operatorStore(p.states.get(`builder ${eid}`)!.storage)
    await g.apply(
      ids.slice(0, 2).map((id, i) => ({
        entity: { eid: id },
        content: { body: words[i] },
      })),
      { trusted: true },
    )
    await page.hear({
      operator: {
        task: card.dataset.task,
        lines: {
          lines: ids.map((id) => ({ id, uses: [id] })),
          entries: ids.map((id, i) => ({
            entity: { eid: id },
            entry: { session: card.dataset.task, seq: 1000 + i },
            created: { at: new Date().toISOString() },
            content: { body: words[i] },
          })),
          helpers: [],
          offers: {},
          tools: {},
        },
        now: '',
      },
    })
    let reported: string[] = []
    let was = globalThis.reportError
    globalThis.reportError = (e: unknown) => void reported.push(String(e))
    try {
      await page.hear({ ready: true, standing: 'moved' })
      await until(() => reported.length == 2)
      await tick()
      assertEquals(
        [...page.document.querySelectorAll('.Transcript_Bubble')]
          .map((r) => r.textContent).filter((t) => words.includes(t!)),
        words.slice(0, 2),
      )
      assertEquals(
        reported.sort(),
        ids.slice(0, 2).map((id) =>
          `Error: The Operator chat page left out words of the person it had shown: ${id}`
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
test('a helper’s line landing before the conversation is answered is read, once', async () => {
  // The Operator's work owed from before is done, so no step of it lands.
  await p.builder(eid).alarm()
  await p.settled()
  // The Builder object's store, beside the object, as another write lands.
  let store = await operatorStore(p.states.get(`builder ${eid}`)!.storage)
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
  await page.answered()
  await tick()
  let still = page.talks()
  page.leave()
  // Its page graph's first handshake goes unanswered while a line lands.
  let landed = await load(storage(), false, park, {}, undefined, 'held')
  let box = landed.document.querySelector('[data-conversation]')!
  await g.apply([told('Find the north shelter’s June dates too')], {
    trusted: true,
  })
  await landed.pass(60_000, () => landed.talks() > 0)
  await landed.received()
  assertEquals([still, landed.talks()], [0, 1])
  // what it was told closed, its words fetched as it opens
  assertStringIncludes(
    box.innerHTML,
    'The context the helper was given changed here',
  )
  landed.leave()
})

// The aside in the margin (operator-aside.ts), kept live from the graph: a
// helper's own page shows its turn under way as each of its steps lands, and
// the conversation that started it lists it with how it stands, linked to
// its run.
test('a helper’s page and its conversation’s aside follow its steps as they land', async () => {
  let store = await operatorStore(p.states.get(`builder ${eid}`)!.storage)
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
  // How a row stands is its mark's label, beside its title.
  let stands = (page: typeof own, at: string) =>
    page.document.querySelector(`${at} .Rows_Name .Dot`)
      ?.getAttribute('aria-label') ?? ''
  let row = `[data-helping] [data-help="${helper}"]`
  // The helper reads the same wherever it is drawn: in the aside, in the
  // step that started it, and in the aside on its own page.
  let alike: string[][] = []
  let drawn = () => {
    let at = `[data-help="${helper}"] .Rows_Meta`
    alike.push(
      [
        text(theirs, `[data-helping] ${at}`),
        text(theirs, `[data-conversation] ${at}`),
        text(own, `[data-self] ${at}`),
      ].map((t) => t.replace(/\d+s$/, 'Ns')),
    )
    // A helper's own page says no turn of its own: its row in the aside
    // does. The aside's row says how it stands, then where it runs.
    let says = (page: typeof own, at: string) =>
      text(page, at).replace(/\d+s$/, 'Ns')
    return [
      says(own, '[data-turn]'),
      `${stands(theirs, row)}: ${says(theirs, `${row} .Rows_Name`).trim()} · ${
        says(theirs, `${row} .Rows_Meta`)
      }`,
      says(theirs, `${row} [data-runs]`),
    ]
  }
  let first = drawn()
  let link = theirs.document.querySelector(`${row} a`)?.getAttribute('href')
  // The Operator's frames, which this test tells of the helper's steps it
  // writes, each step said to both pages as their conversations hear it.
  let frames = operatorFrames(
    store,
    undefined,
    () => Promise.resolve({ opens: link?.replace(/\/[^/]+$/, '') }),
  )
  let watches = [own, theirs].map((page) => ({
    page,
    heard: 0,
    watch: talking(frames, person, eid),
  }))
  await Promise.all(watches.map((w) => w.watch.ready()))
  let tell = async (session: string) => {
    await frames.tell(session)
    for (let w of watches) {
      for (let step of w.watch.steps().slice(w.heard)) {
        w.heard++
        await w.page.hear({ operator: step })
      }
    }
  }
  await tell(helper)
  let tool = crypto.randomUUID()
  await step({ ask: {}, using: {} })
  await step({
    entity: { eid: tool },
    call: { to: crypto.randomUUID(), args: {} },
  })
  await tell(helper)
  let running = drawn()
  await step({ result: { call: tool }, content: { body: 'ok' } })
  await step({ output: {}, content: { body: 'Imported 100 people.' } })
  await tell(helper)
  let ended = drawn()
  own.leave()
  theirs.leave()
  assertEquals(first, [
    '',
    'Running: Import the people CSV · Thinking · Ns',
    'yaks.app',
  ])
  assertEquals(
    link?.endsWith(`/${helper}`),
    true,
    'the helper links to its run',
  )
  assertEquals(
    running[1].includes('Thinking'),
    false,
    'its tool, not thinking',
  )
  assertStringIncludes(running[1], 'Running: ')
  assertEquals(ended, [
    '',
    'Done: Import the people CSV · just now',
    'yaks.app',
  ])
  assertEquals(alike, [
    Array(3).fill('Thinking · Ns'),
    alike[1].map(() => alike[1][0]),
    Array(3).fill('just now'),
  ])
  assertEquals(
    theirs.document.querySelector(`${row} a`)?.getAttribute('href'),
    link,
  )
})

// On a phone, or wherever the aside is put away, the bar's button to it
// wears a summary: a dot for the turn and each helper, how many more past
// four, drawn again as each lands, and it opens the aside as a layer.
test('the bar’s button to the aside shows a dot for each, “+N” past four, and opens it', async () => {
  let store = await operatorStore(p.states.get(`builder ${eid}`)!.storage)
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
  let button = () => document.querySelector('.Frame_Bar [data-aside-open]')!
  let glance = () => button().querySelector('[data-glance]')!
  let aside = document.querySelector('#aside [data-aside]')!
  let dots = () =>
    [...glance().querySelectorAll('.Dot')].map((d) => d.className)
  // Each the list draws, the turn under way among them.
  let listed = document.querySelectorAll('[data-helping] > *').length +
    document.querySelectorAll('[data-turn] time').length
  let first = {
    dots: dots(),
    more: glance().textContent,
    hidden: aside.hasAttribute('hidden'),
    opens: button().getAttribute('href'),
  }
  // A helper's step lands: its dot changes, and the button says so.
  let at = new Date().toISOString()
  await page.hear({
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
  let label = button().getAttribute('aria-label')
  let description = button().getAttribute('aria-description')
  page.leave()
  assertEquals(first.hidden, false)
  assertEquals(first.opens, '#aside')
  assertEquals(first.dots.length, 4, 'four dots, then how many more')
  assertEquals(listed >= 1 + helpers.length, true, 'the turn and each helper')
  assertEquals(first.more, `+${listed - 4}`)
  assertEquals(label, 'Open the conversation panel')
  assertStringIncludes(description!, '2 failed')
})

// A step that changed no line.
let none = { lines: [], entries: [], helpers: [], offers: {}, tools: {} }

// A reply's words reach the page as they are written, through its page
// graph and no socket of its own, and are drawn once: across a reconnect
// mid-reply, which answers with the words so far, and as the step that wrote
// them lands.
test('a reply shows as it is written, once across a reconnect, until its step lands', async () => {
  let page = await load(storage(), false, park)
  let task = page.document.querySelector('[data-task]')!.getAttribute(
    'data-task',
  )!
  let last = () =>
    page.document.querySelector('[data-conversation] .Transcript_Lines')!
      .lastElementChild!.textContent!
  await page.answered()
  await page.hear({ typing: 'It is the ', writing: task })
  await page.hear({ typing: 'lentil soup.' })
  let written = last()
  let talks = page.talks()
  // The page graph's socket opens again: the conversation stands where the
  // page drew it, and the reply's words so far come whole.
  await page.hear({
    ready: true,
    standing: page.standing()!,
    typing: 'It is the lentil soup. With bread.',
    writing: task,
  })
  let again = last()
  await page.hear({ operator: { task, lines: none, now: '' } })
  let landed = page.document.querySelector('[data-conversation]')!.textContent!
  page.leave()
  assertStringIncludes(written, 'It is the lentil soup.')
  assertStringIncludes(again, 'It is the lentil soup. With bread.')
  assertEquals(again.split('It is the').length, 2, 'drawn once')
  assertEquals(page.talks(), talks, 'nothing read again')
  assertEquals(landed.includes('With bread.'), false, 'the step took its place')
  assertEquals(page.sockets.length, 0)
})

// The watch's answer can hold no row (a conversation not theirs any more, a
// store answering it after a restore): the page keeps what it shows, and a
// later answer and its steps are heard as ever.
test('a conversation’s row taken away leaves the page as it stands, and its next answer is heard', async () => {
  let page = await load(storage(), false, park)
  let task = page.document.querySelector('[data-task]')!.getAttribute(
    'data-task',
  )!
  await page.answered()
  let shown = page.document.querySelector('[data-conversation]')!.innerHTML
  let talks = page.talks()
  await page.hear({ ready: true, gone: true })
  let kept = page.document.querySelector('[data-conversation]')!.innerHTML
  await page.hear({ ready: true, standing: page.standing()! })
  await page.hear({
    operator: { task, lines: none, now: 'Thinking…', doing: 'thinking' },
  })
  let now = [...page.document.querySelectorAll('[data-task] [data-now]')]
    .at(-1)?.textContent
  page.leave()
  assertEquals([kept == shown, page.talks()], [true, talks])
  assertEquals(now, 'Thinking…')
})

// However long the conversation, the page graph holds one row of it beside
// the entries its steps drew, each step's frame replacing the last's.
test('a long conversation is one row in the page graph, whatever its steps', async () => {
  let page = await load(storage(), false, park)
  let task = page.document.querySelector('[data-task]')!.getAttribute(
    'data-task',
  )!
  await page.answered()
  let steps = 200
  for (let i = 0; i < steps; i++) {
    let id = crypto.randomUUID()
    await page.hear({
      operator: {
        task,
        lines: {
          lines: [{ id, uses: [id] }],
          entries: [{
            entity: { eid: id },
            entry: { session: task, seq: 2000 + i },
            created: { at: new Date().toISOString() },
            output: {},
            content: { body: `Step ${i} of the long run` },
          }],
          helpers: [],
          offers: {},
          tools: {},
        },
        now: '',
      },
    })
  }
  let [graph] = [...page.view.tab.graphs.values()] as unknown as {
    graph: { read: (q: string) => Promise<{ operatorTalk?: Told }[]> }
  }[]
  let rows = await graph.graph.read('.operatorTalk&*')
  let entries = await graph.graph.read('.entry&*')
  let bytes = (b: unknown) => new TextEncoder().encode(JSON.stringify(b)).length
  page.leave()
  assertEquals(rows.length, 1)
  assertEquals(rows[0].operatorTalk?.n, steps)
  assert(bytes(rows) < 2_000, `its row is the last step's: ${bytes(rows)} B`)
  assert(entries.length >= steps, 'each step’s entries, which it draws')
})

// Drafts are read only as the store's socket answers: one it cannot open is
// tried again, and a page is never asked to read them on a timer.
test('a page whose store cannot be reached says its draft is kept, and asks for it no other way', async () => {
  let page = await load(storage(), false, 'new', {}, undefined, 'down')
  // until the page says so, within a minute, then a hundred seconds more
  let said = await page.pass(60_000, () => page.status() != '')
  await page.pass(100_000)
  assertEquals(said, true)
  assertEquals(
    page.status(),
    'Your draft is kept on this device until syncing returns.',
  )
  assertEquals(page.asked(), 0)
  assert(page.probes() > 0, 'HTTP could not reach its store either')
  assert(page.handshakes() > 2, 'its socket was tried again')
  page.leave()
})

test('a connected page reassures while offline, then clears its reassurance when its store reconnects', async () => {
  let page = await load(storage(), false, 'new', {}, undefined, 'down')
  try {
    page.recover()
    assert(await page.pass(60_000, () => page.read() && page.status() == ''))
    page.disconnect()
    assert(await page.pass(60_000, () => page.status() != ''))
    assertEquals(
      page.status(),
      'Your draft is kept on this device until syncing returns.',
    )
    page.recover()
    assert(await page.pass(60_000, () => page.status() == ''))
    assertEquals(page.asked(), 0)
  } finally {
    page.leave()
  }
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
  await until(async () =>
    await stored('operator:' + road) == 'Add the hearing date and the agenda'
  )
  assertEquals(
    await stored('operator:' + road),
    'Add the hearing date and the agenda',
  )
  t.stops()
  await tick()
  await page.hear({
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
let growingStore = await operatorStore(p.states.get(`builder ${eid}`)!.storage)
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
  growingEntry('An earlier step', true),
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
    // The page draws the newest lines; the reader asks for the earlier ones
    // until there are none.
    let earlier = () =>
      page.document.querySelector('[data-task] > button') as Element | null
    let all = async () => {
      for (let button; (button = earlier());) {
        let hidden = button.textContent
        page.press(button)
        await until(() => earlier()?.textContent != hidden, {
          label: 'earlier lines becoming visible',
        })
        await page.received()
      }
    }
    try {
      await all()
      assertEquals(words(), oldWords)
      await growingStore.g.apply([
        growingEntry('A later step', true),
        growingEntry('The newest request'),
      ], { trusted: true })
      await page.hear({ ready: true, standing: 'changed' })
      await until(() => words().includes('The newest request'))
      await all()
      assertEquals(words(), [...oldWords, 'The newest request'])
      let talks = page.talks()
      await page.hear({ ready: true, standing: 'reconnected' })
      await until(() => page.talks() > talks)
      await page.received()
      await all()
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
  let copiedText = actionTrigger.getAttribute('data-entry-text')!
  entryActions.press(actionTrigger)
  entryActions.press(actionMenu.querySelector('[data-entry-copy]')!)
  await until(() => entryActions.copied.length)
  entryActions.press(actionTrigger)
  entryActions.press(actionMenu.querySelector('[data-entry-link]')!)
  await until(() => entryActions.copied.length == 2)
  entryActions.press(actionTrigger)
  entryActions.press(actionMenu.querySelector('[data-entry-quote]')!)
  await until(async () => {
    let draft = await stored('operator:' + park)
    return draft.includes('Keep this draft') && draft.includes(copiedText)
  })
  // The one menu serves every line: the last one's time fills it with its own.
  let lastTrigger = [
    ...entryActions.document.querySelectorAll<HTMLElement>(
      '[data-menu-trigger]',
    ),
  ].at(-1)!
  entryActions.press(lastTrigger)
  let archive = actionMenu.querySelector<HTMLElement>('[data-entry-archive]')!
  let hiding = [archive.hidden, archive.textContent]
  entryActions.press(actionMenu.querySelector('[data-entry-copy]')!)
  await until(() => entryActions.copied.length == 3)
  let quotedDraft = entryActions.say.value
  entryActions.leave()
  let quotedAgain = await load(storage(), false, park)
  await quotedAgain.heard()
  let quoteAfterReload = quotedAgain.say.value
  quotedAgain.leave()

  assertEquals(entryActions.copied[0], copiedText)
  assertEquals(
    entryActions.copied[2],
    lastTrigger.getAttribute('data-entry-text'),
  )
  assertEquals(hiding, [
    !lastTrigger.dataset.archiveEntries,
    lastTrigger.dataset.restore == 'true' ? 'Restore' : 'Hide',
  ])
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
