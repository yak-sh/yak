// The page reporter (page.js) as a page runs it: a fresh copy is loaded under
// a stand-in window, a resource error is fired at its capture listener, and
// what it asked the server and what it sent to the report door are read.
import { equal, test, tick } from '@yaks/testing'

let at = 'https://ada.yaks.app/cookbook/'
let file = `${at}api/assets/80230632-aacf-41d8-8e97-f2477f05e38c/styles.css?v=5`
// Named beside this file, so a change to the reporter runs these again.
let page = new URL('./page.js', import.meta.url)
let n = 0

type El = { tagName: string; href?: string; src?: string; type?: string }

// Fire `el`'s failed load at a page whose server answers each address with
// the status `files` gives it, or drops the connection for any other.
let load = async (el: El, files: Record<string, number>) => {
  let asked: string[] = []
  let said: string[] = []
  let heard = new Map<string, (e: unknown) => void>()
  let keep = {
    document: globalThis.document,
    location: Object.getOwnPropertyDescriptor(globalThis, 'location'),
    fetch: globalThis.fetch,
    error: console.error,
    listen: globalThis.addEventListener,
  }
  let g = globalThis as Record<string, unknown>
  g.document = {
    currentScript: { dataset: { yakAt: '/cookbook/', yakVersion: '5' } },
    baseURI: at,
    readyState: 'complete',
    body: { innerText: 'A cookbook with plenty on the page. '.repeat(4) },
  }
  Object.defineProperty(globalThis, 'location', {
    value: new URL(at),
    configurable: true,
  })
  g.fetch = async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/report')) {
      said.push(JSON.parse(await (init?.body as Blob).text()).message)
      return new Response(null, { status: 204 })
    }
    asked.push(url)
    if (!(url in files)) throw new TypeError('Load failed')
    return new Response('body', { status: files[url] })
  }
  g.addEventListener = (type: string, on: (e: unknown) => void) =>
    heard.set(type, on)
  try {
    await import(`${page.href}?${n++}`)
    heard.get('error')!({ target: el })
    await tick()
    await tick()
  } finally {
    g.document = keep.document
    Reflect.deleteProperty(globalThis, 'location')
    if (keep.location) {
      Object.defineProperty(globalThis, 'location', keep.location)
    }
    g.fetch = keep.fetch
    console.error = keep.error
    g.addEventListener = keep.listen
  }
  return { asked, said }
}

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
