// A dashboard page hearing of a newer deploy (public/deploy.js), in a page
// whose clock is stepped by hand: it is held for the next link, never
// reloaded.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { stays } from '@yaks/ui/navigate'
import { page } from './pages.ts'

let code = await Deno.readTextFile(
  new URL('./public/deploy.js', import.meta.url),
)
let OLD = { id: 'old', at: '2026-11-06T10:00:00Z' }
let NEW = { id: 'new', at: '2026-11-07T10:00:00Z' }

let browser = (answer = NEW) => {
  let { document } = parseHTML(
    `<!doctype html><html><body><textarea name="say"></textarea><script data-deploy="${OLD.id}" data-deploy-at="${OLD.at}"></script></body></html>`,
  )
  let d = document as unknown as Document
  let hidden = false
  Object.defineProperties(d, {
    currentScript: { value: d.querySelector('script[data-deploy]') },
    visibilityState: { get: () => hidden ? 'hidden' : 'visible' },
  })
  let clock = 1_000_000
  let on: Record<string, ((e: { persisted?: boolean }) => void)[]> = {}
  let asks: string[] = []
  let reloads = 0
  let w = {
    document,
    Date: { now: () => clock, parse: Date.parse },
    location: { reload: () => reloads++ },
    fetch: (url: string) => {
      asks.push(url)
      return Promise.resolve(Response.json({ signedIn: true, deploy: answer }))
    },
    addEventListener: (kind: string, fn: () => void) =>
      (on[kind] ??= []).push(fn),
  }
  d.addEventListener = w
    .addEventListener as unknown as typeof d.addEventListener
  new Function('w', `with (w) {${code}}`)(w)
  return {
    asks,
    held: () => stays(d),
    reloads: () => reloads,
    fire: async (kind: string, e = {}) => {
      on[kind]?.forEach((fn) => fn(e))
      for (let i = 0; i < 8; i++) await Promise.resolve()
    },
    pass: (ms: number) => clock += ms,
    hide: (on = true) => hidden = on,
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

test('a newer deploy holds the page for the next link to load whole, and nothing reloads it, idle, typing or hidden', async () => {
  let b = browser()
  await b.fire('yak-reconnect')
  assertEquals(b.asks, ['/login/who'])
  assert(b.held())
  b.pass(600_000)
  b.hide()
  await b.fire('visibilitychange')
  b.hide(false)
  await b.fire('visibilitychange')
  await b.fire('online')
  assertEquals([b.reloads(), b.asks.length], [0, 1])
})

test('an older or the same deploy leaves the page to move in place', async () => {
  for (let answer of [OLD, { id: 'older', at: '2026-11-01T00:00:00Z' }]) {
    let b = browser(answer)
    await b.fire('yak-reconnect')
    assertEquals([b.held(), b.reloads()], [false, 0])
  }
})

test('coming back into view asks at most once a minute', async () => {
  let b = browser()
  await b.fire('visibilitychange')
  assertEquals(b.asks.length, 0)
  b.pass(60_000)
  await b.fire('visibilitychange')
  assertEquals([b.asks.length, b.held()], [1, true])
})
