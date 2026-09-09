import { assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { clock, timed } from './timing.ts'

Deno.test('worker Server-Timing names wall time total', () => {
  let now = 1000
  using _date = stub(Date, 'now', () => now)
  let c = clock()
  now += 41
  let response = timed(new Response('ok'), c)
  assertEquals(
    response.headers.get('server-timing'),
    'hops;dur=0, r2;dur=0, total;dur=41',
  )
})
