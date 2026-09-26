// A browsing context, faked whole for each test: nav.tsx reads location,
// history and the two web stores as it goes. Everything a launch can be —
// cold, warm, deep-linked, a second tab — is then one line.
import { faked } from '../testing.ts'
import { assertEquals } from '@std/assert'
import { cache, census } from '../live.ts'
import { navigate, restore, route } from './nav.tsx'

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

let context = () =>
  faked({
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
  })

// The canvas the app opens on, and a task to walk into.
let graph = () => {
  cache.value = {
    canvas: { entity: { eid: 'canvas', num: 1 }, canvas: { eid: 'canvas' } },
    task: {
      entity: { eid: 'task', num: 7 },
      doc: { eid: 'task', title: 'a task' },
    },
  }
  census.value = ['canvas', 'task']
}

// A page LOAD: a fresh set of history entries, the module's own route
// init, then the restore main.tsx runs once the cache is full. `cold` is
// a new browsing context (an app launch, a new tab) — sessionStorage goes
// with the old one.
let launch = (url: string, cold = true) => {
  if (cold) session.clear()
  entries = [url]
  at(url)
  route.value = place.pathname + place.search
  restore()
}

let back = () => {
  entries.pop()
  at(entries[entries.length - 1])
  dispatchEvent(new Event('popstate'))
}

let here = () => place.pathname + place.search

// A test's browsing context, from an empty device on the canvas, until the
// test ends.
let fresh = () => {
  let held = context()
  local.clear()
  session.clear()
  graph()
  launch('/')
  return held
}

Deno.test('a cold launch resumes the card and the view it was left in', () => {
  using _ = fresh()
  navigate('/?v=List')
  navigate('/T-7?v=Md')

  launch('/')
  assertEquals(route.value, '/T-7?v=Md')
  assertEquals(here(), '/T-7?v=Md') // the url says what the screen shows
})

Deno.test('back from a restored card reaches the canvas it was left on', () => {
  using _ = fresh()
  navigate('/?v=List')
  navigate('/T-7')

  launch('/')
  assertEquals(entries, ['/?v=List', '/T-7']) // the canvas seeded beneath
  back()
  assertEquals(route.value, '/?v=List')
  assertEquals(here(), '/?v=List')
})

Deno.test('the root canvas keeps its own view choice', () => {
  using _ = fresh()
  navigate('/?v=List')

  launch('/')
  assertEquals(route.value, '/?v=List')
  assertEquals(entries, ['/?v=List']) // nothing to go back to: this IS home
})

Deno.test('an explicit / in a live tab shows the canvas, never the card', () => {
  using _ = fresh()
  navigate('/T-7')

  launch('/', false) // the brand is a native anchor — tapping home is a load
  assertEquals(route.value, '/')
  assertEquals(entries, ['/'])
})

Deno.test('going home once makes the canvas the next cold launch', () => {
  using _ = fresh()
  navigate('/T-7')
  launch('/', false)

  launch('/')
  assertEquals(route.value, '/')
})

Deno.test('a deep link wins over the memory', () => {
  using _ = fresh()
  navigate('/T-7')

  launch('/1') // the canvas by its own number, cold
  assertEquals(route.value, '/1')
  assertEquals(entries, ['/1'])
})

Deno.test('a remembered entity that has died falls back to the canvas', () => {
  using _ = fresh()
  navigate('/?v=List')
  navigate('/T-7')
  cache.value = {
    canvas: { entity: { eid: 'canvas', num: 1 }, canvas: { eid: 'canvas' } },
  }
  census.value = ['canvas']

  launch('/')
  assertEquals(route.value, '/?v=List')
  assertEquals(entries, ['/?v=List'])
})

Deno.test('a second tab is a cold launch and resumes where you were', () => {
  using _ = fresh()
  navigate('/?v=List')
  navigate('/T-7')

  launch('/') // sessionStorage belongs to the tab that closed
  assertEquals(route.value, '/T-7')
  back()
  assertEquals(route.value, '/?v=List') // and the way back came with it
})

Deno.test('a device that refuses storage still opens the canvas', () => {
  using _ = fresh()
  navigate('/T-7')
  let no = () => {
    throw new Error('private mode')
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: no, setItem: no, clear: () => {} },
    configurable: true,
  })
  try {
    launch('/')
    assertEquals(route.value, '/')
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      value: local,
      configurable: true,
    })
  }
})

Deno.test('chrome and dead ends are not places you were', () => {
  using _ = fresh()
  navigate('/T-7')
  navigate('/admin')
  navigate('/T-404')

  launch('/')
  assertEquals(route.value, '/T-7')
})
