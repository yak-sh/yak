// Who a stranger at a private published app is served as, what a publish
// does with its sample, and what a browser's cookies spare the directory.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { Stale } from '@yaks/graph/errors'
import type { Bundle } from '@yaks/graph'
import {
  barOf,
  due,
  holder,
  holding,
  type Ledger,
  opens,
  resampled,
  revisited,
  type Sample,
  type Served,
  settled,
  storeCookie,
  STORES,
  unborn,
  type Visit,
  visitEdge,
  visiting,
  visitorRole,
} from './visits.ts'

let handle = 'ada/notes.1f'
let demo: Sample = {
  store: `${handle}/demo/d`,
  seed: 's',
  version: 2,
  release: '2',
}
let app: Served = {
  access: 'private',
  store: handle,
  script: 'live-script',
  declaration: '3',
  published: { name: 'notes', version: 2 },
  demo,
}
let own: Visit = {
  store: `${handle}/visit/o`,
  blobs: '.visits/o/blobs/',
  seen: null,
  adopted: null,
}
let browser = { person: null, role: null, via: 'v' }

// What `who` is served, as `[visit, store, role, kept]`.
let served = (
  who: Parameters<typeof visiting>[2],
  visit: Visit | null,
  offer: Partial<typeof app> = {},
) => {
  let s = visiting(handle, { ...app, ...offer }, who, visit)
  return [s.visit, s.app.store, s.who.role, s.who.visit?.kept ?? null]
}

test('a stranger reads the sample until they hold a store of their own', () => {
  let cases: [string, unknown[], unknown[]][] = [
    ['no store yet', [browser, null], ['sample', demo.store, 'viewer', false]],
    ['a store of their own', [browser, own], [
      'own',
      own.store,
      'editor',
      false,
    ]],
    ['signed in, no seat', [{ ...browser, person: 'p' }, own], [
      'own',
      own.store,
      'editor',
      false,
    ]],
    ['installed already', [browser, { ...own, adopted: 'b' }], [
      'kept',
      demo.store,
      'viewer',
      true,
    ]],
    ['a member', [{ ...browser, role: 'owner' }, own], [
      null,
      handle,
      'owner',
      null,
    ]],
    ['no browser', [{ ...browser, via: undefined }, null], [
      null,
      handle,
      null,
      null,
    ]],
  ]
  for (let [why, [who, visit], want] of cases) {
    assertEquals(
      served(who as typeof browser, visit as Visit | null),
      want,
      why,
    )
  }
  assertEquals(served(browser, null, { demo: null })[0], null, 'no sample')
  assertEquals(served(browser, null, { access: 'open' })[0], null, 'open app')
})

test('a stranger is served the published release, on its own script', () => {
  let live = visiting(handle, app, browser, null).app
  assertEquals([live.script, live.declaration], ['live-script', '2'])
  let old = visiting(handle, app, browser, null, { script: 'r2-script' }).app
  assertEquals(old.script, 'r2-script')
  let older = visiting(handle, app, browser, null, { script: null }).app
  assertEquals(older.script, handle)
})

test("a visit's worker comes back to the store it was served", () => {
  let back = (store: string, offer: Partial<typeof app> = {}) => {
    let a = revisited(handle, { ...app, ...offer }, store)
    return a && [a.store, a.blobs ?? null]
  }
  assertEquals(back(demo.store), [demo.store, null])
  assertEquals(back(own.store), [own.store, own.blobs])
  assertEquals(back('ada/other.2a/visit/o'), null)
  assertEquals(back(`${handle}/visit/o/x`), null)
  assertEquals(back(demo.store, { demo: null }), null)
})

test("a signed-out browser's standing is read again from its visit", () => {
  let role = (store: string | null, visit: Visit | null, offer = app) =>
    visitorRole(offer, store, visit)
  assertEquals(role(demo.store, null), 'viewer')
  assertEquals(role(own.store, own), 'editor')
  assertEquals(role(own.store, null), null)
  assertEquals(role(`${handle}/visit/x`, own), null)
  assertEquals(role(own.store, { ...own, adopted: 'b' }), null)
  assertEquals(role(own.store, own, { ...app, published: null! }), null)
})

test('who a private app opens to', () => {
  assertEquals(opens({ access: 'public' }), true)
  assertEquals(opens(app), true)
  assertEquals(opens({ ...app, demo: null }), false)
  assertEquals(opens({ ...app, published: null }), false)
})

test('a republish keeps the sample its words and seed already made', () => {
  let now = { seed: 's', version: 2, release: '2' }
  assertEquals(resampled(demo, now), { to: 'kept', sample: demo })
  assertEquals(resampled(demo, { ...now, version: 3, release: '3' }), {
    to: 'moved',
    sample: { ...demo, version: 3, release: '3' },
  })
  assertEquals(resampled(demo, { ...now, seed: 't' }), { to: 'made' })
  assertEquals(resampled(null, now), { to: 'made' })
})

test("a visitor's bar keeps what they made by installing it", () => {
  let visit = { kept: false }
  assertEquals(barOf({}, app, { person: 'p', visit }), {
    keep: 'https://yaks.app/install?name=notes',
    says: 'Keep it',
  })
  assertEquals(
    barOf({}, app, { person: null, visit })?.says,
    'Sign up to keep it',
  )
  assertEquals(barOf({}, app, { person: 'p', visit: { kept: true } }), null)
  assertEquals(barOf({}, app, { person: 'p' }), null)
})

test("a visit's use is written down at most hourly", () => {
  let at = new Date('2026-11-03T12:00:00Z')
  assertEquals(
    [null, '2026-11-03T11:30:00Z', '2026-11-03T10:59:00Z'].map((s) =>
      due(s, at)
    ),
    [true, false, true],
  )
})

// A directory holding `rows`, which counts its reads and keeps its writes.
let ledger = (rows: Bundle[] = [], refuse = false) => {
  let reads = 0, wrote: Bundle[] = []
  let l: Ledger = {
    query: () => {
      reads++
      return Promise.resolve(rows)
    },
    apply: (b) => {
      if (refuse) return Promise.reject(new Stale('e', 'visit', 'store', 'w'))
      wrote.push(...b)
      return Promise.resolve([])
    },
  }
  return { l, reads: () => reads, wrote }
}

test("a browser's cookies spare the directory its stores", async () => {
  let me = holder('v')
  let row = {
    entity: { eid: visitEdge('v', 'notes') },
    edge: { to: 'notes' },
    visit: { store: own.store, blobs: own.blobs },
  }
  let held = async (cookie: string | null, newcomer = false) => {
    let d = ledger([row])
    let { visit, tell } = await holding(
      d.l,
      { cookie, newcomer },
      'v',
      'notes',
    )
    return [visit?.store ?? null, tell, d.reads()]
  }
  let named = `${STORES}=${me}; ${storeCookie('notes')}=${me}`
  assertEquals(await held(null, true), [null, [STORES], 0])
  assertEquals(await held(`${STORES}=${me}`), [null, [], 0])
  assertEquals(await held(named), [own.store, [], 1])
  assertEquals(await held(null), [own.store, [
    STORES,
    storeCookie('notes'),
  ], 1])
  assertEquals((await held(`${STORES}=someone-else`))[2], 1)
})

test('the first birth keeps the edge, and a racing one takes it', async () => {
  let first = ledger()
  assertEquals(await settled(first.l, 'v', 'notes', own), own)
  assertEquals(first.wrote.length, 2)
  let won = { ...own, store: `${handle}/visit/w` }
  let racing = ledger([{ entity: { eid: 'e' }, visit: won }], true)
  assertEquals((await settled(racing.l, 'v', 'notes', own)).store, won.store)
})

test('a stranger refused a store signs up and comes back', async () => {
  let req = new Request('https://ada.yaks.app/notes/api/apply', {
    headers: { referer: 'https://ada.yaks.app/notes/' },
  })
  let res = unborn(req, {})
  let { error } = await res.json()
  assertEquals([res.status, error.code, error.signIn], [
    429,
    'sign_up',
    'https://yaks.app/login?return=https%3A%2F%2Fada.yaks.app%2Fnotes%2F',
  ])
})
