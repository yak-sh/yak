import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { clock, timed } from './timing.ts'

test('worker Server-Timing names wall time total', () => {
  let now = 1000
  using _date = stub(Date, 'now', () => now)
  let c = clock()
  now += 41
  let response = timed(new Response('ok'), c)
  assertEquals(
    response.headers.get('server-timing'),
    'hops;dur=0, stmts;dur=0, r2;dur=0, total;dur=41',
  )
})

test('worker Server-Timing preserves native compiler durations', () => {
  let c = clock()
  c.include('compiler_total;dur=123.456, compiler_parse;dur=2.001')
  let res = timed(new Response('ok'), c)
  assertEquals(
    res.headers.get('server-timing')!.startsWith(
      'compiler_total;dur=123.456, compiler_parse;dur=2.001, ',
    ),
    true,
  )
})

test('an inner serving clock names its phases apart from the gateway', () => {
  let c = clock()
  c.include('file_total;dur=9, file_config;dur=3')
  assertEquals(
    timed(new Response('ok'), c, 'site_').headers.get('server-timing')!
      .startsWith(
        'site_file_total;dur=9, site_file_config;dur=3, site_hops;dur=0',
      ),
    true,
  )
})
