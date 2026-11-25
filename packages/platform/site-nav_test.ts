import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { island, signedIn } from './site-nav.ts'

test('an early Open yaks.app tap joins the document already being prefetched', async () => {
  let { document, Event } = parseHTML(
    `<html><body>${signedIn}</body></html>`,
  )
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
  let press = new Event('click', { bubbles: true, cancelable: true })
  document.querySelector('.Nav_Open')!.dispatchEvent(press)
  assertEquals(press.defaultPrevented, true)
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
