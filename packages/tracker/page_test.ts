// The page reporter (page.js) as a page runs it: a fresh copy is run as a
// classic script over a stand-in window, a resource error is fired at its
// capture listener or a fetch is made through its wrapper, and what it asked
// the server and what it sent to the report door are read.
import { equal, test } from '@yaks/testing'

let at = 'https://ada.yaks.app/cookbook/'
let file = `${at}api/assets/80230632-aacf-41d8-8e97-f2477f05e38c/styles.css?v=5`
// Named beside this file, so a change to the reporter runs these again.
let code = await Deno.readTextFile(new URL('./page.js', import.meta.url))

type El = { tagName: string; href?: string; src?: string; type?: string }

// A page whose server answers each address with the status `files` gives it,
// or drops the connection for any other.
let page = (files: Record<string, number>) => {
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
  new Function(...Object.keys(scope), code)(...Object.values(scope))
  let said = () =>
    Promise.all(sent.map(async (b) => JSON.parse(await b.text()).message))
  return { win, heard, asked, said }
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

test("the page's own scripts failing are filed, wherever they sit", async () =>
  equal([await threw(at, 300), await threw(`${at}app.js`, 1)].flat(), [
    "Can't find variable: __firefox__",
    "Can't find variable: __firefox__",
  ]))

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
