import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { publicPage } from './public-cache.ts'

test('a deployed public page revalidates before drawing again', async () => {
  let env = { APEX: 'yaks.app', CF_VERSION_METADATA: { id: 'deploy-one' } }
  let drawn = 0
  let draw = () => {
    drawn++
    return new Response('this deployment')
  }
  let url = 'https://yaks.app/docs/querying'
  let first = await publicPage(new Request(url), env, '/docs/querying', draw)
  let etag = first?.headers.get('etag') ?? ''
  assertEquals(first?.status, 200)
  assertEquals(
    first?.headers.get('cache-control'),
    'public, max-age=300, must-revalidate',
  )
  assertEquals(await first?.text(), 'this deployment')
  let again = await publicPage(
    new Request(url, { headers: { 'if-none-match': etag.slice(2) } }),
    env,
    '/docs/querying',
    draw,
  )
  assertEquals(again?.status, 304)
  assertEquals(await again?.text(), '')
  assertEquals(drawn, 1)
  let changed = await publicPage(
    new Request(url, { headers: { 'if-none-match': etag } }),
    { ...env, CF_VERSION_METADATA: { id: 'deploy-two' } },
    '/docs/querying',
    draw,
  )
  assertEquals(changed?.status, 200)
  assertEquals(drawn, 2)
})

test('a changing representation rotates its validator within a deploy', async () => {
  let env = { CF_VERSION_METADATA: { id: 'deploy-one' } }
  let url = 'https://yaks.app/.well-known/security.txt'
  let first = await publicPage(
    new Request(url),
    env,
    '/.well-known/security.txt',
    () => new Response('day one'),
    60,
    '2026-09-28',
  )
  let changed = await publicPage(
    new Request(url, {
      headers: { 'if-none-match': first?.headers.get('etag') ?? '' },
    }),
    env,
    '/.well-known/security.txt',
    () => new Response('day two'),
    60,
    '2026-09-29',
  )
  assertEquals(changed?.status, 200)
  assertEquals(await changed?.text(), 'day two')
})

test('a page without deploy metadata is not stored', async () => {
  let res = await publicPage(
    new Request('https://yaks.app/docs'),
    {},
    '/docs',
    () => new Response('development'),
  )
  assertEquals(res?.headers.get('cache-control'), 'private, no-store')
  assertEquals(res?.headers.get('etag'), null)
})
