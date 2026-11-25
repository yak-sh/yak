import { equal, test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  type FetchLike,
  FILES,
  type Keeping,
  keeping,
  type Scope,
} from './worker.ts'
import { FRESH, KEPT, SHELL } from './picture.ts'

// The address a request names, a Request or a string.
let key = (r: RequestInfo | URL) =>
  typeof r == 'object' && 'url' in r ? r.url : String(r)

// A site's worker over caches held in memory, and a network that answers
// each address with what `site` says of it now: a page, or an answer of its
// own. `more` is what else the site keeps by.
let worker = (files = 2, more: Partial<Keeping> = {}) => {
  let stores = new Map<string, Map<string, Response>>()
  let cache = (name: string): Cache => {
    let held = stores.get(name) ?? new Map<string, Response>()
    stores.set(name, held)
    return {
      match: (r: RequestInfo | URL) =>
        Promise.resolve(held.get(key(r))?.clone()),
      put: async (r: RequestInfo | URL, res: Response) => {
        held.set(key(r), new Response(await res.arrayBuffer(), res))
      },
      delete: (r: RequestInfo | URL) => Promise.resolve(held.delete(key(r))),
      keys: () =>
        Promise.resolve([...held.keys()].map((url) => new Request(url))),
    } as unknown as Cache
  }
  let caches = {
    open: (name: string) => Promise.resolve(cache(name)),
    delete: (name: string) => Promise.resolve(stores.delete(name)),
  } as unknown as CacheStorage
  let site = new Map<string, string | (() => Promise<Response>)>()
  let navigator = { onLine: true }
  let asked: string[] = []
  let hear = new Map<string, (e: unknown) => void>()
  let databases = ['yaks-page:ada', 'yaks', 'yaks-page:bo']
  let scope: Scope = {
    caches,
    indexedDB: {
      databases: () =>
        Promise.resolve(databases.map((name) => ({ name, version: 1 }))),
      deleteDatabase: (name: string) => {
        databases = databases.filter((n) => n != name)
        return {} as IDBOpenDBRequest
      },
    },
    location: { origin: 'https://yaks.app' },
    navigator,
    clients: { claim: () => Promise.resolve() },
    fetch: (r: RequestInfo | URL) => {
      let url = key(r)
      asked.push(new URL(url).pathname)
      let body = site.get(new URL(url).pathname)
      if (typeof body == 'function') return body()
      return Promise.resolve(
        body == null ? new Response('gone', { status: 404 }) : new Response(
          body,
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        ),
      )
    },
    addEventListener: (type: string, fn: (e: never) => void) =>
      hear.set(type, fn as (e: unknown) => void),
  }
  keeping(scope, {
    forget: ['/logout'],
    named: '/_yak/',
    files,
    databases: 'yaks-page:',
    opens: (p) => (p as { url?: string }).url,
    shelled: (url) => new URL(url).pathname.startsWith('/manage'),
    ...more,
  })
  let waiting: Promise<unknown>[] = []
  let settled = async () => {
    while (waiting.length) await waiting.shift()
  }
  // What the worker answers a request with: its body, or null where it
  // leaves the request to the network.
  let ask = async (
    path: string,
    o: {
      mode?: RequestMode
      method?: string
      fresh?: boolean
      preloadResponse?: Promise<Response | undefined>
    } = {},
  ) => {
    let answer: Promise<Response> | undefined
    let request = {
      url: 'https://yaks.app' + path,
      mode: o.mode ?? 'cors',
      method: o.method ?? 'GET',
      headers: new Headers(o.fresh ? { [FRESH]: '1' } : {}),
    } as Request
    let e: FetchLike = {
      request,
      preloadResponse: o.preloadResponse,
      respondWith: (r) => void (answer = r),
      waitUntil: (p) => void waiting.push(p),
    }
    hear.get('fetch')!(e)
    await settled()
    return answer ? await (await answer).text() : null
  }
  let open = (path: string) => ask(path, { mode: 'navigate' })
  let activate = async () => {
    hear.get('activate')!({
      waitUntil: (p: Promise<unknown>) => void waiting.push(p),
    })
    await settled()
  }
  let leave = async (
    path: string,
    html: string,
    since = Date.now(),
    shell?: string,
  ) => {
    hear.get('message')!({
      data: { keep: 'https://yaks.app' + path, html, shell, at: 1, since },
      waitUntil: (p: Promise<unknown>) => void waiting.push(p),
    })
    await settled()
  }
  // What a picture that could not be replaced tells its worker.
  let failed = (path: string) => {
    let heard: unknown[] = []
    hear.get('message')!({
      data: { network: 'https://yaks.app' + path },
      ports: [{ postMessage: (m: unknown) => heard.push(m) }],
      waitUntil: (p: Promise<unknown>) => void waiting.push(p),
    })
    return heard
  }
  let push = async (pushed: unknown) => {
    hear.get('push')!({
      data: { json: () => pushed },
      waitUntil: (p: Promise<unknown>) => void waiting.push(p),
    })
    await settled()
  }
  return {
    scope,
    activate,
    site,
    navigator,
    asked,
    ask,
    open,
    leave,
    failed,
    push,
    stores,
    databases: () => databases,
  }
}

let page = (said: string) =>
  `<!doctype html><html><head><script type="module" src="/_yak/a.js"></script></head><body><p>${said}</p></body></html>`

test('a page left is drawn again at once as a kept picture, and its bootstrap gets the page as it is now', async () => {
  let w = worker()
  w.site.set('/checks', page('now'))
  assertEquals(await w.open('/checks'), page('now'))
  await w.leave('/checks', page('as last seen'))
  w.asked.length = 0
  let drawn = (await w.open('/checks'))!
  assertEquals(drawn.includes('as last seen'), true)
  assertEquals(drawn.includes(`${KEPT}="1"`), true)
  assertEquals(drawn.includes('<script type="module"'), false)
  // The network was asked once, as the picture was drawn, and the bootstrap
  // takes that answer instead of asking again.
  assertEquals(w.asked, ['/checks'])
  assertEquals(await w.ask('/checks', { fresh: true }), page('now'))
  assertEquals(w.asked, ['/checks'])
})

test('signing out forgets every kept page and page graph, and a page loaded before it keeps nothing after', async () => {
  let w = worker()
  w.site.set('/checks', page('now'))
  let loaded = Date.now() - 1000
  await w.leave('/checks', page('mine'), loaded)
  assertEquals(
    await w.ask('/logout', { mode: 'navigate', method: 'POST' }),
    null,
  )
  assertEquals(w.databases(), ['yaks'])
  // The page being left as it signs out sends its snapshot after.
  await w.leave('/checks', page('mine, again'), loaded)
  assertEquals(await w.open('/checks'), page('now'))
  await w.leave('/checks', page('the next person'))
  assertEquals((await w.open('/checks'))!.includes('the next person'), true)
})

test('a file named by its bytes is answered from what was kept, the newest few of them once a page is left', async () => {
  let w = worker(2)
  for (let n of [1, 2, 3]) w.site.set(`/_yak/f${n}.js`, `file ${n}`)
  for (let n of [1, 2, 3]) {
    assertEquals(await w.ask(`/_yak/f${n}.js`), `file ${n}`)
  }
  // Counted as a page is left, not as a loading page asks for each.
  await w.leave('/checks', page('seen'))
  w.site.clear()
  w.asked.length = 0
  assertEquals(await w.ask('/_yak/f3.js'), 'file 3')
  assertEquals(await w.ask('/_yak/f2.js'), 'file 2')
  assertEquals(w.asked, [])
  assertEquals([...w.stores.get(FILES)!.keys()].length, 2)
  // Everything else is the network's alone.
  assertEquals(await w.ask('/api/query'), null)
})

test('a push keeps the page its notification opens as it is then, to draw at once even offline', async () => {
  let w = worker()
  w.site.set('/checks/c1', page('the reply'))
  await w.push({ url: '/checks/c1?from=3#row-e1', title: 'Hazel replied' })
  await w.push({ close: ['t1'] })
  await w.push({ url: '/gone' })
  w.site.clear()
  let drawn = (await w.open('/checks/c1?from=3'))!
  assertEquals(drawn.includes('the reply'), true)
  assertEquals(drawn.includes(KEPT), true)
  assertEquals(await w.open('/gone'), 'gone')
})

test('a page with no picture of its own opens at once as the shell where the shell stands for it', async () => {
  let w = worker()
  w.site.set('/manage/updates', page('the updates'))
  w.site.set('/pricing', page('prices'))
  await w.leave('/manage/chat', page('the chat'), Date.now(), page(''))
  w.asked.length = 0
  let drawn = (await w.open('/manage/updates'))!
  assertEquals([drawn.includes(SHELL), drawn.includes('the chat')], [
    true,
    false,
  ])
  assertEquals(
    await w.ask('/manage/updates', { fresh: true }),
    page('the updates'),
  )
  assertEquals(w.asked, ['/manage/updates'])
  // Not where the site says the shell does not stand.
  assertEquals(await w.open('/pricing'), page('prices'))
  await w.ask('/logout', { mode: 'navigate', method: 'POST' })
  assertEquals(await w.open('/manage/updates'), page('the updates'))
})

test('a picture that could not be replaced opens next from the network, once', async () => {
  let w = worker()
  w.site.set('/checks', page('now'))
  await w.leave('/checks', page('as last seen'))
  assertEquals(w.failed('/checks#row-1'), [true])
  assertEquals(await w.open('/checks'), page('now'))
  assertEquals((await w.open('/checks'))!.includes(KEPT), true)
})

test('a network-only upgrade drops old pictures without reopening any window', async () => {
  let w = worker(2, { pictures: false })
  await (await w.scope.caches.open('yak-pages')).put(
    'https://yaks.app/checks',
    new Response('a picture from the previous release'),
  )
  let reopens: string[] = []
  let clients = {
    claim: () => Promise.resolve(),
    matchAll: () =>
      Promise.resolve([{
        url: 'https://yaks.app/checks',
        navigate: (url: string) => Promise.resolve(reopens.push(url)),
      }]),
  }
  let enabled = false
  w.scope.clients = clients
  w.scope.registration = {
    navigationPreload: {
      enable: () => {
        enabled = true
        return Promise.resolve()
      },
    },
  }
  await w.activate()
  equal(w.stores.has('yak-pages'), false)
  equal(reopens, [])
  equal(enabled, true)
})

test('network-only opens use the browser request, including a slow answer or an offline failure', async () => {
  let w = worker(2, {
    pictures: false,
    failed: ({ state }) => state,
    forget: ['/login'],
  })
  let { promise, resolve } = Promise.withResolvers<Response>()
  let opened = w.ask('/checks', { mode: 'navigate', preloadResponse: promise })
  equal(w.asked, [])
  resolve(new Response('ready'))
  equal(await opened, 'ready')
  equal(
    await w.ask('/login', {
      mode: 'navigate',
      preloadResponse: Promise.resolve(new Response('sign in')),
    }),
    'sign in',
  )
  w.navigator.onLine = false
  equal(
    await w.ask('/checks', {
      mode: 'navigate',
      preloadResponse: Promise.reject(new TypeError('Load failed')),
    }),
    'offline',
  )
  equal(w.asked, [])
  w.site.set('/checks', 'network fallback')
  equal(
    await w.ask('/checks', {
      mode: 'navigate',
      preloadResponse: Promise.resolve(undefined),
    }),
    'network fallback',
  )
  equal(w.asked, ['/checks'])
})

test("an open the network cannot give is answered with the site's page saying why, and a slow one is waited for", async () => {
  let w = worker(2, {
    failed: (why) => `${why.state}: ${why.said}`,
    drew: (html) => html.includes('ours'),
  })
  let answer = (status: number, body: string) => () =>
    Promise.resolve(new Response(body, { status }))
  w.site.set('/fine', 'the page')
  w.site.set('/down', () => Promise.reject(new TypeError('Load failed')))
  w.site.set(
    '/slow',
    () => new Promise((done) => setTimeout(done, 20, new Response('at last'))),
  )
  w.site.set('/broke', answer(502, 'Error 502'))
  w.site.set('/oops', answer(500, 'ours: Something went wrong'))
  w.site.set('/gone', answer(404, 'Not here'))
  equal(await w.open('/fine'), 'the page')
  equal(await w.open('/down'), 'unreachable: TypeError: Load failed')
  equal(await w.open('/slow'), 'at last')
  equal(await w.open('/broke'), 'failed: The server answered 502')
  equal(await w.open('/oops'), 'ours: Something went wrong')
  equal(await w.open('/gone'), 'Not here')
  w.navigator.onLine = false
  equal(await w.open('/down'), 'offline: TypeError: Load failed')
})
