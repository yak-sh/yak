import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { RETRY, source, tooMany, visitorKey, within } from './rate.ts'

let at = (ip?: string) =>
  new Request('https://x.test/', {
    headers: ip ? { 'cf-connecting-ip': ip } : {},
  })
let answering = (success: boolean) => ({
  limit: () => Promise.resolve({ success }),
})

test('a source goes on while its limiter lets it', async () => {
  let heard: unknown[] = []
  let failed = (e: unknown) => heard.push(e)
  let broken = { limit: () => Promise.reject(new Error('counter down')) }
  for (
    let [lim, key, ok] of [
      [answering(true), '2001:db8::1', true],
      [answering(false), '2001:db8::1', false],
      [answering(false), '', true],
      [undefined, '2001:db8::1', true],
      [broken, '2001:db8::1', true],
    ] as const
  ) assertEquals(await within(lim, key, failed), ok)
  assertEquals(heard.map((e) => (e as Error).message), ['counter down'])
})

test('a visitor is their person, else their address, else a stranger', () => {
  assertEquals(source(at('2001:db8::1')), '2001:db8::1')
  assertEquals(visitorKey({ person: 'p' }, at('2001:db8::1')), 'p')
  assertEquals(visitorKey({ person: null }, at('2001:db8::1')), '2001:db8::1')
  assertEquals(visitorKey({ person: null }, at()), 'stranger')
})

test('too many says when to come back', async () => {
  let res = tooMany()
  assertEquals(res.status, 429)
  assertEquals(res.headers.get('retry-after'), String(RETRY))
  assertEquals(
    await res.text(),
    'Too many requests from one place. Try again in a minute.',
  )
})
