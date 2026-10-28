import { clock as virtual, test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { clock, timed } from './timing.ts'

test('worker Server-Timing names wall time total', async () => {
  let time = virtual(1000)
  let c = clock(time.now)
  await time.advance(41)
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
