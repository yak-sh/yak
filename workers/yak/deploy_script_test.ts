// A dashboard page moving onto a newer deploy (public/deploy.js), in a page
// whose clock, timers, storage and reload are stepped by hand.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { page } from './pages.ts'

let code = await Deno.readTextFile(
  new URL('./public/deploy.js', import.meta.url),
)
let OLD = { id: 'old', at: '2026-11-06T10:00:00Z' }
let NEW = { id: 'new', at: '2026-11-07T10:00:00Z' }
let BODY =
  `<form><textarea name="say"></textarea><input name="title" value="Soup">
<input type="hidden" name="request" value="r1"></form>
<details id="step"><summary>Step</summary></details><div data-card></div>`

let browser = (
  opts: {
    answer?: typeof NEW
    kept?: Map<string, string>
    hidden?: boolean
    // what the page's own scripts did before this one ran
    before?: (d: Document) => void
  } = {},
) => {
  let { document, window } = parseHTML(
    `<!doctype html><html><body>${BODY}<script data-deploy="${OLD.id}" data-deploy-at="${OLD.at}"></script></body></html>`,
  )
  let d = document as unknown as Document
  let active: Element | null = null
  let selected: [number, number] | null = null
  // What linkedom's fields, entries and focus do not reflect.
  for (let el of d.querySelectorAll('input, textarea')) {
    let drawn = el.getAttribute('value') ?? el.textContent ?? ''
    let value = drawn
    Object.defineProperties(el, {
      defaultValue: { value: drawn },
      value: { get: () => value, set: (v) => value = v },
      focus: { value: () => active = el },
      selectionStart: { get: () => selected?.[0] ?? null },
      selectionEnd: { get: () => selected?.[1] ?? null },
      setSelectionRange: { value: (a: number, b: number) => selected = [a, b] },
    })
  }
  for (let el of d.querySelectorAll('details')) {
    Object.defineProperty(el, 'open', {
      get: () => el.hasAttribute('open'),
      set: (on) => el.toggleAttribute('open', on),
    })
  }
  Object.defineProperties(d, {
    currentScript: { value: d.querySelector('script[data-deploy]') },
    activeElement: { get: () => active },
    visibilityState: { get: () => opts.hidden ? 'hidden' : 'visible' },
    readyState: { value: 'interactive' },
  })
  Object.defineProperty(d.documentElement, 'scrollHeight', { value: 2000 })
  let clock = 1_000_000
  let timers = new Map<number, [number, () => void]>()
  let n = 0
  type Heard = { type?: string; persisted?: boolean }
  let on: Record<string, ((e: Heard) => void)[]> = {}
  let storage = opts.kept ?? new Map<string, string>()
  let asks: string[] = []
  let at = { x: 0, y: 0 }
  let reloads = 0
  let w = {
    document,
    Event: window.Event,
    Date: { now: () => clock, parse: Date.parse },
    location: { pathname: '/manage/ada/operator', reload: () => reloads++ },
    history: { scrollRestoration: 'auto' },
    sessionStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
    fetch: (url: string) => {
      asks.push(url)
      return Promise.resolve(
        Response.json({ signedIn: true, deploy: opts.answer ?? NEW }),
      )
    },
    setTimeout: (fn: () => void, ms: number) => {
      timers.set(++n, [clock + ms, fn])
      return n
    },
    clearTimeout: (id: number) => timers.delete(id),
    addEventListener: (kind: string, fn: (e: Heard) => void) =>
      (on[kind] ??= []).push(fn),
    dispatchEvent: (e: Heard) => on[e.type!]?.forEach((fn) => fn(e)),
    scrollTo: (x: number, y: number) => at = { x, y },
    get scrollX() {
      return at.x
    },
    get scrollY() {
      return at.y
    },
    innerHeight: 800,
  }
  // The window and the document are heard alike.
  d.addEventListener = w
    .addEventListener as unknown as typeof d.addEventListener
  opts.before?.(d)
  new Function('w', `with (w) {${code}}`)(w)
  let settle = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  }
  return {
    d,
    storage,
    asks,
    at,
    reloads: () => reloads,
    field: (name: string) =>
      d.querySelector(`[name=${name}]`) as HTMLTextAreaElement,
    focused: () => active,
    selected: () => selected,
    fire: async (kind: string, e = {}) => {
      on[kind]?.forEach((fn) => fn(e))
      await settle()
    },
    scroll: (y: number) => at = { x: 0, y },
    // Time passes, and each timer due in it runs.
    pass: async (ms: number) => {
      let end = clock + ms
      for (;;) {
        let due = [...timers].filter(([, [t]]) => t <= end)
          .sort(([, [a]], [, [b]]) => a - b)[0]
        if (!due) break
        timers.delete(due[0])
        clock = due[1][0]
        due[1][1]()
        await settle()
      }
      clock = end
    },
    hide: () => opts.hidden = true,
    restoration: () => w.history.scrollRestoration,
  }
}

test('dashboard pages wear the deploy that drew them, and only where one runs', async () => {
  let drawn = (meta?: { id: string; timestamp: string }) =>
    page({ CF_VERSION_METADATA: meta }, { title: 'Here' }, 'hi').text()
  assert((await drawn({ id: 'v1', timestamp: OLD.at })).includes(
    `/deploy.js" data-deploy="v1" data-deploy-at="${OLD.at}" defer>`,
  ))
  assert(!(await drawn()).includes('/deploy.js'))
})

test('a reopened socket learns of a newer deploy, and the page moves once typing stops, keeping what was typed', async () => {
  let b = browser()
  await b.fire('yak-reconnect')
  assertEquals(b.asks, ['/login/who'])
  let say = b.field('say')
  say.value = 'make me a soup app'
  say.focus()
  say.setSelectionRange(4, 6)
  b.scroll(1200)
  await b.fire('keydown')
  await b.pass(2000)
  assertEquals(b.reloads(), 0)
  await b.pass(1000)
  assertEquals(b.reloads(), 1)
  let kept = JSON.parse(b.storage.get('yak-deploy:/manage/ada/operator')!)
  assertEquals(kept.fields, [['say:1', 'make me a soup app', null]])
  assertEquals(kept.focus, ['say:1', 4, 6])
  assertEquals([kept.y, kept.bottom], [1200, true])
  assertEquals(b.storage.get('yak-deploy'), 'new')
})

test('the moved page puts back its scroll, entries, focus and typing, as if typed', () => {
  let kept = new Map([[
    'yak-deploy:/manage/ada/operator',
    JSON.stringify({
      x: 0,
      y: 300,
      bottom: false,
      open: [['step:1', true]],
      fields: [['say:1', 'half a thought', null]],
      focus: ['say:1', 2, 2],
    }),
  ]])
  let typed: string[] = []
  let b = browser({
    kept,
    before: (d) => {
      let say = d.querySelector('[name=say]') as HTMLTextAreaElement
      say.addEventListener('input', () => typed.push(say.value))
    },
  })
  assertEquals(typed, ['half a thought'])
  assertEquals(b.field('title').value, 'Soup')
  assert(b.d.querySelector('#step')!.hasAttribute('open'))
  assertEquals(b.focused(), b.field('say'))
  assertEquals(b.selected(), [2, 2])
  assertEquals(b.at, { x: 0, y: 300 })
  assertEquals(kept.size, 0)
})

test('a busy page waits, even hidden; an older, the same or an already moved-to deploy never moves it', async () => {
  let b = browser({ hidden: true })
  b.d.querySelector('[data-card]')!.setAttribute('data-pending', '')
  await b.fire('online')
  await b.pass(10_000)
  assertEquals(b.reloads(), 0)
  b.d.querySelector('[data-card]')!.removeAttribute('data-pending')
  await b.pass(1000)
  assertEquals(b.reloads(), 1)

  for (let answer of [OLD, { id: 'older', at: '2026-11-01T00:00:00Z' }]) {
    let same = browser({ answer })
    await same.fire('yak-reconnect')
    await same.pass(10_000)
    assertEquals(same.reloads(), 0)
  }
  let moved = browser({ kept: new Map([['yak-deploy', 'new']]) })
  await moved.fire('yak-reconnect')
  await moved.pass(10_000)
  assertEquals(moved.reloads(), 0)
})

test('coming back into view asks at most once a minute, and a hidden page moves at once', async () => {
  let b = browser()
  await b.fire('visibilitychange')
  assertEquals(b.asks.length, 0)
  await b.pass(60_000)
  await b.fire('keydown')
  await b.fire('visibilitychange')
  assertEquals([b.asks.length, b.reloads()], [1, 0])
  b.hide()
  await b.fire('visibilitychange')
  assertEquals(b.reloads(), 1)
})

test('the moved page gives the browser back the scroll restoring the page had', async () => {
  for (let had of ['manual', undefined]) {
    let kept = new Map([[
      'yak-deploy:/manage/ada/operator',
      JSON.stringify({
        x: 0,
        y: 0,
        bottom: true,
        open: [],
        fields: [],
        restoration: had,
      }),
    ]])
    let b = browser({ kept })
    await b.fire('load')
    assertEquals(b.restoration(), had ?? 'auto')
  }
})
