import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { island, signedIn } from './site-nav.ts'

let page = (prerendering = false, who: unknown = null, pencil?: string) => {
  let { document, Event } = parseHTML(
    `<html><head><script data-yak-at="/" data-yak-version="7"></script></head><body>${signedIn}</body></html>`,
  )
  Object.assign(document, { prerendering })
  let module = Promise.withResolvers<{
    ready: (link: Element, to: string, first: Promise<Response>) => () => void
  }>()
  let prefetch = Promise.withResolvers<Response>()
  let opened = Promise.withResolvers<string>()
  let requests: string[] = []
  let fallback: string[] = []
  let script = island('/ready.js', pencil).slice(
    '<script>'.length,
    -'</script>'.length,
  )
    .replace('import(', 'load(')
  new Function('document', 'localStorage', 'fetch', 'location', 'load', script)(
    document,
    { getItem: () => '1' },
    (to: string) => {
      requests.push(to)
      if (to.startsWith('/login/who') && who) {
        return Promise.resolve(Response.json(who))
      }
      return to == '/manage' ? prefetch.promise : new Promise(() => {})
    },
    { assign: (to: string) => fallback.push(to) },
    () => module.promise,
  )
  let tap = () => {
    let press = new Event('click', { bubbles: true, cancelable: true })
    document.querySelector('.Nav_Open')!.dispatchEvent(press)
    return press.defaultPrevented
  }
  let activate = () => {
    Object.assign(document, { prerendering: false })
    document.dispatchEvent(new Event('prerenderingchange'))
  }
  return {
    activate,
    tap,
    module,
    prefetch,
    opened,
    requests,
    fallback,
    document,
  }
}

test('an early Open yaks.app tap joins the document already being prefetched', async () => {
  let { tap, module, prefetch, opened, requests, fallback } = page()
  assertEquals(tap(), true)
  assertEquals(requests, ['/login/who?chat', '/manage'])
  module.resolve({
    ready: (_link, _to, first) => async () => {
      opened.resolve(await (await first).text())
    },
  })
  prefetch.resolve(new Response('The chat'))
  assertEquals(await opened.promise, 'The chat')
  assertEquals(fallback, [])
})

test('a prerendered Home waits for activation to check sign-in and warm the Operator', () => {
  let { activate, requests } = page(true)
  assertEquals(requests, [])
  activate()
  activate()
  assertEquals(requests, ['/login/who?chat', '/manage'])
})

// A page of the home app is the same for everyone; its writer's check answers
// the pencil's tag, which the island draws with the page's release.
test('a home app page draws the pencil its sign-in check answers, and only that page', async () => {
  let who = {
    signedIn: true,
    pencil: { 'data-yak-edit': '/ada/chat?app=home', 'data-yak-api': '/home/' },
  }
  let drawn = async (pencil?: string) => {
    let { document, requests } = page(false, who, pencil)
    await new Promise((done) => setTimeout(done))
    let tag = document.querySelector('script[data-yak-edit]')
    return {
      asked: requests[0],
      tag: tag && [
        tag.getAttribute('src'),
        tag.getAttribute('data-yak-api'),
        tag.getAttribute('data-yak-version'),
      ],
    }
  }
  assertEquals(await drawn('/edit.js'), {
    asked: '/login/who?chat&pencil',
    tag: ['/edit.js', '/home/', '7'],
  })
  assertEquals(await drawn(), { asked: '/login/who?chat', tag: null })
})
