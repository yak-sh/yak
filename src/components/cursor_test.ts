// The cursor: navigation as graph data (T-12788). A browsing context is faked
// whole the way restore_test does — location/history and the web stores go in
// FIRST, the module is imported after — plus a WebSocket stub so mark()'s wire
// send lands nowhere instead of leaking a real socket. Real UUID eids here (not
// restore_test's synthetic 'canvas'/'task'), because mark() writes them through
// the same eid grammar apply() enforces, which only a UUID clears.
import { assertEquals } from '@std/assert'
import { applyLocal, cache, census, myCursor } from '../live.ts'

let CLIENT = '00000000-0000-4000-8000-0000000000c1'
let CANVAS = '00000000-0000-4000-8000-000000000001'
let TASK = '00000000-0000-4000-8000-000000000007'

let place = { pathname: '/', search: '' }
let entries: string[] = ['/']
let at = (url: string) => {
  let u = new URL(url, 'http://x')
  place.pathname = u.pathname
  place.search = u.search
}
let store = () => {
  let m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
}
let local = store()
let session = store()
// The client id nav reads for its cursor — pinned so the row is addressable.
local.setItem('tasks-client', CLIENT)

// A wire that goes nowhere: connect() news this up and wire() sends against an
// OPEN one, so a stubbed OPEN socket swallows every mutate without a real fd.
class FakeSocket {
  static OPEN = 1
  readyState = 1
  send() {}
  addEventListener() {}
  close() {}
}

for (
  let [k, v] of Object.entries({
    location: place,
    history: {
      pushState: (_s: unknown, _t: string, url: string) => {
        entries.push(url)
        at(url)
      },
      replaceState: (_s: unknown, _t: string, url: string) => {
        entries[entries.length - 1] = url
        at(url)
      },
    },
    localStorage: local,
    sessionStorage: session,
    WebSocket: FakeSocket,
    navigator: { userAgent: 'test' },
  })
) Object.defineProperty(globalThis, k, { value: v, configurable: true })

// nav.tsx captures location/history at module init, so import it only after
// the fakes are installed (restore_test's rule); live.ts reads globals lazily.
let { navigate, route } = await import('./nav.tsx')

// The graph the app opens on: a root canvas and a task to walk into.
let graph = () => {
  cache.value = {
    [CANVAS]: {
      entity: { eid: CANVAS, num: 1 },
      canvas: { eid: CANVAS },
    },
    [TASK]: {
      entity: { eid: TASK, num: 7 },
      task: { eid: TASK, priority: 0 },
      doc: { eid: TASK, title: 'a task' },
    },
  }
  census.value = [CANVAS, TASK]
}

let go = (url: string) => {
  entries = [url]
  at(url)
  route.value = place.pathname + place.search
}

Deno.test('navigating writes this client’s cursor into the graph', () => {
  graph()
  go('/')
  navigate(`/T-7`)
  let cur = myCursor(CLIENT)
  assertEquals(cur?.target, TASK) // where the tab now looks, as data
  assertEquals(cur?.client, CLIENT) // one row, this client's
})

Deno.test('the cursor row is idempotent — one per client', () => {
  graph()
  go('/')
  navigate(`/T-7`)
  let first = myCursor(CLIENT)?.eid
  navigate(`/T-7`) // same place: no new row, no churn
  assertEquals(myCursor(CLIENT)?.eid, first)
})

// The cursor is UPDATE-ONLY: a write to this client's cursor row — by an agent's
// `show`, another client, or a stale server row — must NOT move the tab. This is
// the bug that made P-19 inescapable: a cursor left pointing there yanked every
// attempt to open something else straight back.
Deno.test('a cursor write never navigates the tab (update-only)', () => {
  graph()
  go('/') // the tab sits on the root canvas
  let cur = '00000000-0000-4000-8000-0000000000f0'
  // Point this client's cursor at the task, the way `show` would.
  applyLocal([{
    eid: cur,
    name: 'cursor',
    comp: { eid: cur, client: CLIENT, target: TASK },
  }])
  assertEquals(route.value, '/') // stays: rendering ignores the cursor read
})
