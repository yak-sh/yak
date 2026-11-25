import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { island, signedIn } from './site-nav.ts'

let page = (prerendering = false) => {
  let { document, Event } = parseHTML(
    `<html><body>${signedIn}</body></html>`,
  )
  Object.assign(document, { prerendering })
  let module = Promise.withResolvers<{
    ready: (link: Element, to: string, first: Promise<Response>) => () => void
  }>()
  let prefetch = Promise.withResolvers<Response>()
  let opened = Promise.withResolvers<string>()
  let requests: string[] = []
  let fallback: string[] = []
  let script = island('/ready.js').slice('<script>'.length, -'</script>'.length)
    .replace('import(', 'load(')
  new Function('document', 'localStorage', 'fetch', 'location', 'load', script)(
    document,
    { getItem: () => '1' },
    (to: string) => {
      requests.push(to)
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
  return { activate, tap, module, prefetch, opened, requests, fallback }
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
