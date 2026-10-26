// The page reporter (page.js) as a page runs it: a fresh copy is run as a
// classic script over a stand-in window, a resource error is fired at its
// capture listener or a fetch is made through its wrapper, and what it asked
// the server and what it sent to the report door are read.
import { equal, test } from '@yaks/testing'

let at = 'https://ada.yaks.app/cookbook/'
let file = `${at}api/assets/80230632-aacf-41d8-8e97-f2477f05e38c/styles.css?v=5`
// Named beside this file, so a change to the reporter runs these again.
let code = await Deno.readTextFile(new URL('./page.js', import.meta.url))
// The globals a page gives it. The script is compiled once, as the file
// loads; each page runs a fresh copy, closures and all.
let globals = [
  'document',
  'location',
  'navigator',
  'self',
  'globalThis',
  'fetch',
  'addEventListener',
  'removeEventListener',
  'setTimeout',
  'clearTimeout',
] as const
let reporter = new Function(...globals, code)

type El = { tagName: string; href?: string; src?: string; type?: string }

// A page whose server answers each address with the status `files` gives it,
// or drops the connection for any other.
let page = (files: Record<string, number>, scripts: string[] = []) => {
  let asked: string[] = []
  let sent: Blob[] = []
  let heard = new Map<string, (e: unknown) => unknown>()
  let server = (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/report')) {
      sent.push(init?.body as Blob)
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    asked.push(url)
    // A page that stopped waiting hears why: fetch rejects with the reason.
    if (init?.signal?.aborted) return Promise.reject(init.signal.reason)
    return url in files
      ? Promise.resolve(new Response('body', { status: files[url] }))
      : Promise.reject(new TypeError('Load failed'))
  }
  // The window the script runs in: `fetch` is whatever the window holds by
  // then, as a page's own global is.
  let win: { origin: string; fetch: typeof server } = {
    origin: new URL(at).origin,
    fetch: server,
  }
  let scope = {
    document: {
      currentScript: { dataset: { yakAt: '/cookbook/', yakVersion: '5' } },
      baseURI: at,
      scripts: scripts.map((src) => ({ src })),
      readyState: 'complete',
      body: { innerText: 'A cookbook with plenty on the page. '.repeat(4) },
    },
    location: new URL(at),
    navigator: {},
    self: win,
    globalThis: win,
    fetch: (url: string, init?: RequestInit) => win.fetch(url, init),
    addEventListener: (type: string, on: (e: unknown) => unknown) =>
      heard.set(type, on),
    removeEventListener: () => {},
    // The soft state's wait, which these cases leave undrawn.
    setTimeout: () => 0,
    clearTimeout: () => {},
  }
  reporter(...globals.map((name) => scope[name]))
  let bodies = () =>
    Promise.all(sent.map(async (b) => JSON.parse(await b.text())))
  let said = async () => (await bodies()).map((b) => b.message)
  return { win, heard, asked, said, bodies }
}

// Fire `el`'s failed load. The listener answers with its handling, settled
// once the miss is filed or let go.
let load = async (el: El, files: Record<string, number>) => {
  let p = page(files)
  await p.heard.get('error')!({ target: el })
  return { asked: p.asked, said: await p.said() }
}

// The page fetches `url`: what its caller heard, and what was filed.
let call = async (
  url: string,
  files: Record<string, number>,
  signal?: AbortSignal,
) => {
  let p = page(files)
  let heard = await p.win.fetch(url, { signal })
    .then((r) => r.status, (e) => e?.message ?? e)
  return { heard, said: await p.said() }
}

// A script throws, and the browser places it at `filename`, line `lineno`.
let threw = async (filename: string, lineno: number) => {
  let p = page({})
  let error = new ReferenceError("Can't find variable: __firefox__")
  await p.heard.get('error')!({ target: p.win, error, filename, lineno })
  return await p.said()
}

test("a browser's own script failing on the page's first line is not filed", async () =>
  equal(await threw(`${at}#top`, 1), []))

test("the page's own script failing past its first line is filed", async () =>
  equal(await threw(at, 300), ["Can't find variable: __firefox__"]))

test("a script file of the page's failing on its first line is filed", async () =>
  equal(await threw(`${at}app.js`, 1), ["Can't find variable: __firefox__"]))

test('a failure the browser raises with no error is filed by its message', async () => {
  let p = page({})
  let message = 'ResizeObserver loop completed with undelivered notifications.'
  p.heard.get('error')!({ target: p.win, error: null, message, filename: at })
  equal(await p.said(), [message])
})

// A script from another origin throws, and the browser hides all but this.
let muted = async (scripts: string[]) => {
  let p = page({}, scripts)
  let message = 'Script error.'
  p.heard.get('error')!({ target: p.win, error: null, message, lineno: 0 })
  return (await p.bodies()).map((b) => [b.message, b.stack])
}

test('a muted script error names the page and the scripts from elsewhere', async () =>
  equal(await muted([`${at}main.js`, 'https://cdn.test/lib.js', '']), [[
    'Script error.',
    `    at ${at}\n    at https://cdn.test/lib.js`,
  ]]))

test('a muted script error in a page of only its own scripts names the page', async () =>
  equal(await muted([`${at}main.js`]), [['Script error.', `    at ${at}`]]))

let link = { tagName: 'LINK', href: file }

test('a stylesheet whose file answers was dropped, not missing', async () =>
  equal(await load(link, { [file]: 200 }), { asked: [file], said: [] }))

test('a stylesheet the server refuses is reported', async () =>
  equal(await load(link, { [file]: 404 }), {
    asked: [file],
    said: [`failed to load link ${file}`],
  }))

test('a miss that cannot be asked about is not reported', async () =>
  equal(await load(link, {}), { asked: [file], said: [] }))

test("a module's miss is reported unasked: its imports may be missing", async () => {
  let src = file.replace('styles.css', 'app.js')
  equal(
    await load({ tagName: 'SCRIPT', type: 'module', src }, { [src]: 200 }),
    { asked: [], said: [`failed to load script ${src}`] },
  )
})

let release = `${at}api/release?version=5`

test('a fetch the server fails is reported', async () =>
  equal(await call(release, { [release]: 500 }), {
    heard: 500,
    said: ['500 /cookbook/api/release: body'],
  }))

test('a fetch that never had an answer is its caller’s, not a report', async () =>
  equal(await call(release, {}), { heard: 'Load failed', said: [] }))

test('a fetch the page gave up waiting for is reported', async () => {
  let late = new DOMException('timed out', 'TimeoutError')
  equal(await call(release, {}, AbortSignal.abort(late)), {
    heard: 'timed out',
    said: ['/cookbook/api/release: timed out'],
  })
})

test('a fetch the page aborted is not a report', async () =>
  equal(await call(release, {}, AbortSignal.abort('stale')), {
    heard: 'stale',
    said: [],
  }))

// The page fetches `url` and leaves what rejects uncaught, as itself or
// wrapped by `wrap`: what was filed.
let uncaught = async (
  url: string,
  signal?: AbortSignal,
  wrap = (e: unknown) => e,
) => {
  let p = page({})
  let reason = await p.win.fetch(url, { signal }).then(() => null, wrap)
  p.heard.get('unhandledrejection')!({ reason })
  return await p.said()
}

test('an uncaught fetch that never had an answer is not filed', async () =>
  equal(await uncaught(release), []))

test('an uncaught error caused by a fetch with no answer is not filed', async () =>
  equal(
    await uncaught(release, undefined, (e) => Error('no data', { cause: e })),
    [],
  ))

test('an uncaught fetch the page gave up waiting for is filed once', async () => {
  let late = new DOMException('timed out', 'TimeoutError')
  equal(await uncaught(release, AbortSignal.abort(late)), [
    '/cookbook/api/release: timed out',
  ])
})

test('a fetch with no answer the page reports itself is not filed', async () => {
  let p = page({})
  let error = await p.win.fetch(release).then(() => null, (e) => e)
  p.heard.get('error')!({ target: p.win, error, filename: at, lineno: 90 })
  equal(await p.said(), [])
})

test('any other uncaught rejection is filed', async () => {
  let p = page({})
  p.heard.get('unhandledrejection')!({ reason: Error('boom') })
  equal(await p.said(), ['unhandled rejection: boom'])
})
