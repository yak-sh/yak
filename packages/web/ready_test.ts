import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { RESULT, type ResultEvent } from '@yaks/ui/interaction'
import { DRAW, type Drawing, READY } from '@yaks/ui/navigate'
import { ready } from './ready.ts'

let WORKSPACE = `<html><head><title>Hazel · yaks.app</title>
<link rel="stylesheet" href="/pages.css">
<script type="module" src="/_navigate.js" data-navigate></script>
</head><body class="Framed"><main>The chat</main></body></html>`

// Home in a tab, its signed-in view readied from `/manage`, whose answer the
// test gives (`answer`). A press is measured as the page measures it: the
// frame it was drawn in (`drawn`), or a page it left for (`left`).
let home = () => {
  let { document, window, Event } = parseHTML(
    `<html><head><title>yaks.app</title></head><body><div data-site-home>` +
      `<a class="Nav_Open" href="/manage">Open yaks.app</a></div></body></html>`,
  )
  let address = new URL('https://yaks.app/')
  let loads: string[] = []
  let moved = (to: string) => address = new URL(to, address)
  let tab = {
    document,
    Event,
    DOMParser: window.DOMParser,
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    location: {
      get href() {
        return address.href
      },
      get origin() {
        return address.origin
      },
      get pathname() {
        return address.pathname
      },
      get search() {
        return address.search
      },
      get hash() {
        return address.hash
      },
      assign: (to: string) => loads.push(to),
      replace: (to: string) => loads.push(to),
    },
    history: {
      state: null,
      pushState: (_: unknown, __: string, to: string) => moved(to),
      replaceState: (_: unknown, __: string, to: string) => moved(to),
    },
    performance: { now: () => 0, mark: () => {}, measure: () => {} },
    scrollTo: () => {},
    fetch: () => new Promise(() => {}),
    requestAnimationFrame: () => 0,
    setTimeout: () => 0,
    clearTimeout: () => {},
  }
  let measured: string[] = []
  document.addEventListener(
    RESULT,
    (e: Event) =>
      (e as CustomEvent<ResultEvent>).detail.take({
        drawn: () => measured.push('drawn'),
        leaving: () => measured.push('left'),
        cancel: () => measured.push('cancelled'),
      }),
  )
  // The workspace's scripts draw its own addresses (talk-views-browser.ts).
  document.addEventListener(DRAW, (e: Event) => {
    ;(e as CustomEvent<Drawing>).detail.draw = () => {}
  })
  let answered = Promise.withResolvers<Response | null>()
  let was = globalThis.window
  globalThis.window = tab as never
  let open = ready(
    document.querySelector('.Nav_Open') as never,
    '/manage',
    answered.promise,
  )!
  globalThis.window = was
  let view = document.querySelector('[data-site-frame]') as HTMLElement
  let press = () => open(new Event('click'))
  // The page `/manage` redirects to, once its stylesheet loads.
  let answer = async (html: string | null, url = 'https://yaks.app/ada') => {
    answered.resolve(
      html == null ? null : {
        ok: true,
        url,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: () => Promise.resolve(html),
      } as Response,
    )
    for (
      let tick = 0;
      tick < 5 && !document.head.querySelector('link');
      tick++
    ) {
      await new Promise((go) => setTimeout(go))
    }
    document.head.querySelector('link')?.dispatchEvent(new Event('load'))
    await new Promise((go) => setTimeout(go))
  }
  let seen = () => ({
    address: address.pathname,
    title: document.title,
    workspace: !view.inert,
    home: !document.querySelector<HTMLElement>('[data-site-home]')!.inert,
    busy: view.hasAttribute('aria-busy'),
    shows: view.textContent!.trim(),
  })
  let link = document.querySelector('.Nav_Open')!
  // A script of the view's page done loading.
  let loaded = async (script: Element) => {
    script.dispatchEvent(new Event('load'))
    await new Promise((go) => setTimeout(go))
  }
  return { press, answer, seen, measured, loads, view, link, loaded }
}

test('a press before the signed-in page comes draws its frame in its own frame, and the page fills it', async () => {
  let { press, answer, seen, measured } = home()
  await press()
  assertEquals(measured, ['drawn'])
  assertEquals(seen(), {
    address: '/manage',
    title: 'yaks.app',
    workspace: true,
    home: false,
    busy: true,
    shows: 'Loading…',
  })
  await answer(WORKSPACE)
  assertEquals(seen(), {
    address: '/ada',
    title: 'Hazel · yaks.app',
    workspace: true,
    home: false,
    busy: false,
    shows: 'The chat',
  })
})

test('the signed-in page waits unseen until a press shows it through the navigator', async () => {
  let { press, answer, seen, measured, link } = home()
  await answer(WORKSPACE)
  assertEquals(seen().workspace, false)
  assertEquals(seen().shows, 'The chat')
  assertEquals([link.getAttribute('href'), link.hasAttribute(READY)], [
    'https://yaks.app/ada',
    true,
  ])
  await press()
  assertEquals(measured, ['drawn'])
  assertEquals(seen().address, '/ada')
  assertEquals(seen().title, 'Hazel · yaks.app')
})

test("the signed-in page's scripts run before the navigator takes its links", async () => {
  let { answer, view, link, loaded } = home()
  await answer(WORKSPACE.replace(
    '</main>',
    '</main><script type="module" src="/_talk-views.js"></script>',
  ))
  assertEquals(link.hasAttribute(READY), false)
  await loaded(view.querySelector('script[src]')!)
  assertEquals(link.hasAttribute(READY), true)
})

test('a page not to be had is loaded, whether pressed before or after', async () => {
  for (let early of [true, false]) {
    let { press, answer, view, loads, measured } = home()
    if (early) await press()
    await answer(null)
    if (!early) await press()
    assertEquals(view.isConnected, false)
    assertEquals(loads, ['https://yaks.app/manage'])
    assertEquals(measured, early ? ['drawn'] : ['left'])
  }
})

test('a signed-out answer is the sign-in page, loaded in place of the frame', async () => {
  let { press, answer, loads } = home()
  await press()
  await answer(WORKSPACE, 'https://yaks.app/login?return=/manage')
  assertEquals(loads, ['https://yaks.app/manage'])
})
