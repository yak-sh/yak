import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { measure } from './app-compile-time.ts'

test('compile benchmark posts the deploy protocol and keeps work separate from wall', async () => {
  let answer = {
    pages: {},
    assets: {},
    installed: [],
    notes: [],
    errors: [],
    timing: { total: 4, install: 1 },
  }
  let get: typeof fetch = (_url, init) => {
    assertEquals(init?.method, 'POST')
    assertEquals(new Headers(init?.headers).get('x-yak-compiler-job'), '1')
    assertEquals(
      new Headers(init?.headers).get('authorization'),
      'Bearer private',
    )
    assertEquals(init?.body, '{"ask":{}}')
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        headers: { 'server-timing': 'json;dur=2, serialize;dur=1' },
      }),
    )
  }
  let result = await measure(
    '{"ask":{}}',
    'https://private.invalid/',
    'private',
    get,
  )
  assertEquals(result.work, answer.timing)
  assertEquals(result.timing, { json: 2, serialize: 1 })
  assertEquals(
    result.bytes,
    new TextEncoder().encode(JSON.stringify(answer)).length,
  )
  assertEquals(result.wall >= 0, true)
})

test('compile benchmark never labels an old compiler wall time as work', async () => {
  let result = await measure(
    '{}',
    'https://private.invalid/',
    'private',
    () => Promise.resolve(Response.json({ errors: [] })),
  )
  assertEquals(result.work, undefined)
  await assertRejects(
    () =>
      measure(
        '{}',
        'https://private.invalid/',
        'private',
        () => Promise.resolve(Response.json({ errors: ['bad source'] })),
      ),
    Error,
    'bad source',
  )
  await assertRejects(
    () =>
      measure(
        '{}',
        'https://private.invalid/',
        'private',
        () => Promise.resolve(new Response('stopped', { status: 503 })),
      ),
    Error,
    '503',
  )
})
