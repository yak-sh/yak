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
import { chatPage, operatorAnswer } from './operator-page.ts'

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
let load = async (stash: Stash, cut = false) => {
  let html = await (await chatPage(p.env, space, who, 'new')).text()
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
  let fetch = (url: string, init?: RequestInit) =>
    cut && init?.method == 'POST'
      ? new Promise<Response>(() => {})
      : serve(url, init)
  let kept: ReturnType<typeof browserDrafts>[] = []
  let opened: typeof browserDrafts = (client, scope, opts) => {
    let d = browserDrafts(client, scope, { ...opts, stash, pace: 0 })
    kept.push(d)
    return d
  }
  let source = document.querySelector('script[type=module]')!.textContent!
    .replace(/^import .*$/m, '')
  new Function(
    'browserDrafts',
    'document',
    'fetch',
    'location',
    'setTimeout',
    'clearTimeout',
    'FormData',
    'WebSocket',
    source,
  )(
    opened,
    document,
    fetch,
    { reload() {}, origin: 'https://yaks.app' },
    after,
    clearTimeout,
    FormOf,
    // A socket that never opens: the page polls, as with none.
    class {
      onopen?: () => void
      onmessage?: () => void
      onclose?: () => void
    },
  )
  let say = document.querySelector('[name=say]') as HTMLTextAreaElement
  return {
    say,
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
let stored = async () =>
  (await (await serve(`${base}?draft=1`)).json()).bundles[0]?.draft?.text ?? ''

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
