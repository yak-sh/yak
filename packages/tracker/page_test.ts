// The page reporter (page.js) as a page runs it: a fresh copy is run as a
// classic script over a stand-in window, a resource error is fired at its
// capture listener, and what it asked the server and what it sent to the
// report door are read.
import { equal, test } from '@yaks/testing'

let at = 'https://ada.yaks.app/cookbook/'
let file = `${at}api/assets/80230632-aacf-41d8-8e97-f2477f05e38c/styles.css?v=5`
// Named beside this file, so a change to the reporter runs these again.
let code = await Deno.readTextFile(new URL('./page.js', import.meta.url))

type El = { tagName: string; href?: string; src?: string; type?: string }

// Fire `el`'s failed load at a page whose server answers each address with
// the status `files` gives it, or drops the connection for any other.
let load = async (el: El, files: Record<string, number>) => {
  let asked: string[] = []
  let sent: Blob[] = []
  let heard = new Map<string, (e: unknown) => unknown>()
  let server = (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/report')) {
      sent.push(init?.body as Blob)
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    asked.push(url)
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
  let page = {
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
  new Function(...Object.keys(page), code)(...Object.values(page))
  // The listener answers with its handling, settled once the miss is filed
  // or let go.
  await heard.get('error')!({ target: el })
  let said = await Promise.all(
    sent.map(async (b) => JSON.parse(await b.text()).message),
  )
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
