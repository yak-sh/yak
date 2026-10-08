import { bindHistory } from '../history.ts'
import type { HistoryEntry, HistoryPort } from '@yaks/ui/history'
// Home is always the home page a package offers, including devices with an old
// canvas position.
import { test } from '@yaks/testing'
import { faked, tick, until } from '../testing.ts'
import { assertEquals } from '@std/assert'
import { cache, census, owner } from '../live.ts'
import { navigate, restore, route, screenTarget } from './nav.tsx'
import { allSessionsPath } from '../tray_query.ts'
import { offerPlaces } from './offers.ts'
import { host } from '../host_testing.ts'

let place = { pathname: '/', search: '' }
let listeners = new Set<(e: HistoryEntry) => void>()
let port: HistoryPort = {
  read: () => ({ path: place.pathname + place.search, state: null }),
  write: ({ path }, replace) => {
    if (replace) entries[entries.length - 1] = path
    else entries.push(path)
    at(path)
  },
  listen: (fn) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  back: () => {},
  forward: () => {},
}
let entries: string[] = []
let at = (url: string) => {
  let u = new URL(url, 'http://x')
  place.pathname = u.pathname
  place.search = u.search
}
let launch = (url: string) => {
  entries = [url]
  at(url)
  bindHistory(port)
  restore()
}
let context = (
  storage: unknown = {
    getItem: () => '{"at":"/T-7?v=Md","home":"/?v=List"}',
    setItem() {},
  },
) => {
  let prior = owner.value
  let held = faked({
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
    localStorage: storage,
    sessionStorage: storage,
  })
  // A server that knows nothing the cache doesn't: a legacy link it must
  // resolve is answered, and what the test asked closes with it.
  let wire = host(() => ({ bundles: [] }))
  owner.value = 'person'
  offerPlaces({ home: { name: 'Desk', icon: 'lamp', view: 'Desk' } })
  cache.value = {
    person: { entity: { eid: 'person', num: 2 }, person: { eid: 'person' } },
    canvas: { entity: { eid: 'canvas', num: 1 }, canvas: { eid: 'canvas' } },
    task: {
      entity: { eid: 'task', num: 7 },
      doc: { eid: 'task', title: 'Work' },
      task: { eid: 'task' },
    },
  }
  census.value = ['person', 'canvas', 'task']
  return {
    [Symbol.dispose]() {
      held[Symbol.dispose]()
      wire.free()
      offerPlaces({})
      owner.value = prior
      cache.value = {}
      census.value = []
    },
  }
}

test('home opens the home page regardless of previous card, canvas view, listing or dead end', () => {
  using _ = context()
  for (let previous of ['/T-7?v=Md', '/?v=List', allSessionsPath, '/T-404']) {
    launch(previous)
    launch('/')
    assertEquals(route.value, '/')
    assertEquals(entries, ['/'])
    assertEquals(screenTarget(), { eid: 'person', view: 'Desk' })
  }
})

test('deep links keep their entity view and browser back returns home', () => {
  using _ = context()
  launch('/T-7?v=Md')
  assertEquals(screenTarget(), { eid: 'task', view: 'Md' })
  launch('/')
  navigate('/T-7')
  assertEquals(entries, ['/', '/T-7'])
  at('/')
  listeners.forEach((fn) => fn(port.read()))
  assertEquals(screenTarget(), { eid: 'person', view: 'Desk' })
})

test('home opens the home page on a device that refuses storage', () => {
  let no = () => {
    throw new Error('private mode')
  }
  using _ = context({ getItem: no, setItem: no })
  launch('/')
  assertEquals(screenTarget(), { eid: 'person', view: 'Desk' })
})

test('a legacy task link resolves and replaces its address', async () => {
  using _ = context()
  launch('/?task=T-7')
  await until(() => route.value == '/T-7')
  assertEquals(entries, ['/T-7'])
})

test('an unresolved legacy link leaves home reachable', () => {
  using _ = context()
  launch('/?task=gone')
  assertEquals(route.value, '/?task=gone')
  launch('/')
  assertEquals(screenTarget(), { eid: 'person', view: 'Desk' })
})

test('a legacy link never pulls back someone who moved on', async () => {
  using _ = context()
  launch('/?task=T-7')
  navigate('/')
  await tick()
  assertEquals(route.value, '/')
})
