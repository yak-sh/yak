// An app's page whose script never starts, as the kernel serves it: the
// reporter it weaves into the page runs (linkedom), the browser raises what it
// raises for a module it would not link or a script that 404'd, and what the
// reporter sends goes to the app's own door, which files it tagged with the
// page. Chrome and Firefox raise a link failure at the window as a SyntaxError
// whose stack names no frame; Safari raises it at the script element, as every
// browser does a script that would not load.
import { assertEquals, assertMatch } from '@std/assert'
import { test } from '@yaks/testing'
import { broken } from '@yaks/tracker/report'
import { parseHTML } from 'linkedom'
import { client, connector, kernel, seed, unique } from './probe.ts'

let space = unique('start')
let host = `${space}.yaks.app`
let site = `https://${host}/site/`

// The page at `page` as served, its reporter run first, and each sent body.
let opened = (html: string, page: string) => {
  let { document, window } = parseHTML(html)
  let reporter = document.querySelector('script')!
  let sent: Blob[] = []
  Object.defineProperty(document, 'currentScript', { value: reporter })
  let fetch = () => Promise.resolve(new Response(null, { status: 404 }))
  new Function(
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
    reporter.textContent ?? '',
  )(
    document,
    new URL(page),
    { sendBeacon: (_: string, body: Blob) => sent.push(body) },
    { origin: new URL(page).origin },
    { fetch, console: { error: () => {} } },
    fetch,
    window.addEventListener.bind(window),
    window.removeEventListener.bind(window),
    () => 0,
    () => {},
  )
  let main = document.querySelector('script[src]') as HTMLScriptElement
  // An event at the window, or at an element, which the browser hands the
  // window's capturing listener as the event's target.
  let raise = (props: object, target?: Element) => {
    let e = Object.assign(new window.Event('error'), props)
    if (target) {
      Object.defineProperty(e, 'target', { get: () => target, set: () => {} })
    }
    window.dispatchEvent(e)
  }
  return { main, raise, sent }
}

test('a page whose module will not link or load reports it, tagged with the page', async () => {
  let k = await kernel()
  try {
    let { cookie } = await seed(k, [{ slug: space, apps: ['site'] }])
    let files = client(k, host, 'site', cookie)
    let agent = connector(k, cookie)
    let app = { space, app: 'site' }
    await files.put(
      '/index.html',
      '<!doctype html><html><head><script type="module" src="main.js">' +
        '</script></head><body></body></html>',
    )
    await files.put('/main.js', 'import { show } from "./answer.js"\nshow()\n')
    await files.put('/answer.js', 'export let said = 1\n')
    await files.put(
      '/gone.html',
      '<!doctype html><script type="module" src="gone.js"></script>',
    )
    await agent.tool('app_deploy', app)
    let served = async (path: string) =>
      opened(await (await k.at(host, `/site/${path}`)).text(), site + path)
    let filed = (body: Blob) =>
      k.at(host, '/site/api/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })

    // Chrome and Firefox: the SyntaxError, at the window, with no frame.
    let linked = await served('')
    let main = new URL('main.js', site).href
    let error = new SyntaxError(
      "The requested module './answer.js' does not provide an export named 'show'",
    )
    error.stack = `SyntaxError: ${error.message}`
    linked.raise({ error, message: error.message, filename: main, lineno: 1 })
    // Safari: the same failure, at the script element.
    linked.raise({}, linked.main)
    // A script that 404s, as the door answers it.
    assertEquals((await k.at(host, '/site/gone.js')).status, 404)
    let gone = await served('gone.html')
    gone.raise({}, gone.main)

    let bodies = [...linked.sent, ...gone.sent]
    assertEquals(bodies.length, 3)
    let sent = await Promise.all(bodies.map((b) => b.text()))
    assertMatch(sent[0], new RegExp(`at ${main}:1:0`), 'placed where it broke')
    assertEquals(sent.map((b) => broken(b)[0].request), [
      'page /site/',
      'page /site/',
      'page /site/gone.html',
    ])
    for (let body of bodies) assertEquals((await filed(body)).status, 204)

    let listed = await agent.tool('app_errors', app)
    // A break with a place is listed at the file the person opens.
    assertMatch(listed, /\/site\/main\.js:1 — The requested module '\.\/answer/)
    assertMatch(
      listed,
      /page \/site\/ — failed to load script .*\/main\.js/,
    )
    assertMatch(
      listed,
      /page \/site\/gone\.html — failed to load script .*\/gone\.js/,
    )
  } finally {
    await k.stop()
  }
})
