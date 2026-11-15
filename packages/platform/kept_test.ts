// The cache's two load-bearing promises (./kept.ts, T-33197), each asserted on
// the pure seam so it costs nothing to keep asserting:
//
//   1. Two apps never share a cache entry. The cache key is the path, and the
//      hostname is NOT in it, so the eid in the path is the only thing keeping
//      one space's bytes out of another's. That is the cross-tenant leak this
//      whole design is shaped around, and it lives or dies on one string.
//   2. Nothing is cacheable by accident. Omitting `Cache-Control` is not
//      opting out — Cloudflare holds a bare 200 for two hours — so `sealed`
//      says the word for every door that forgot to.
import { test } from '@yaks/testing'
import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from '@std/assert'
import { fileAt, publicPage, sealed } from './kept.ts'

let A = '11111111-1111-4111-8111-111111111111'
let B = '22222222-2222-4222-8222-222222222222'

test('two apps at the same path are two cache entries', () => {
  // The same path in two spaces — `alice.yaks.app/recipes/app.js` and
  // `bob.yaks.app/recipes/app.js` — is one cache key to Cloudflare, because a
  // Worker's cache is keyed without the host. These must not collide.
  assertNotEquals(fileAt(A, '/app.js'), fileAt(B, '/app.js'))
  assertStringIncludes(fileAt(A, '/app.js'), A)
  // The path the app knows itself by survives whole, so Files can read it
  // back off the front.
  let path = (address: string) => new URL(address).pathname
  assertEquals(path(fileAt(A, '/app.js')), `/${A}/app.js`)
  assertEquals(path(fileAt(A, 'app.js')), `/${A}/app.js`)
  assertEquals(path(fileAt(A, '/', 'a/.releases/1/x')), `/${A}/`)
})

test('a door that says nothing is told not to be shared', async () => {
  let bare = sealed(new Response('hello'))
  assertEquals(bare.headers.get('cache-control'), 'private, no-store')
  assertEquals(await bare.text(), 'hello')
})

test('a door that states its policy keeps it', () => {
  let said = sealed(
    new Response('x', { headers: { 'cache-control': 'public, no-cache' } }),
  )
  assertEquals(said.headers.get('cache-control'), 'public, no-cache')
})

test('a socket is left alone', () => {
  // A 101 carries the runtime's own socket and no Response constructor here
  // can copy it, so it must pass through untouched rather than be rebuilt.
  let up = new Response(null, { status: 101 })
  assertEquals(sealed(up), up)
})

// The framing policy (T-33409): an app is the framed resource, and the browser
// refuses to render it inside any space but its own — the clickjacking defense,
// since a same-site frame would otherwise load with the viewer's cookie.
test('every sealed response refuses framing by a foreign space', () => {
  let res = sealed(new Response('a page'))
  assertEquals(
    res.headers.get('content-security-policy'),
    "frame-ancestors 'self' https://yaks.app",
  )
})

test('the platform homepage stays an allowed ancestor', () => {
  // `https://yaks.app` in the list is what sanctions the T-33424 homepage
  // iframe; a space's own apps are the `'self'` half (they share one origin).
  let csp = sealed(new Response('a page')).headers.get(
    'content-security-policy',
  )
  assertStringIncludes(csp!, "'self'")
  assertStringIncludes(csp!, 'https://yaks.app')
})

test('the frame policy rides even on a door with its own cache policy', () => {
  // A door that states its own `cache-control` (a cached app file, the blob)
  // used to pass through sealed untouched, so the header must be applied before
  // that early return or the very responses that get framed would lack it.
  let res = sealed(
    new Response('x', { headers: { 'cache-control': 'public, max-age=60' } }),
  )
  assertEquals(res.headers.get('cache-control'), 'public, max-age=60')
  assertStringIncludes(
    res.headers.get('content-security-policy')!,
    "frame-ancestors 'self' https://yaks.app",
  )
})

test('the frame policy stacks with a response CSP, never clobbers it', () => {
  // The blob door (apps.ts `gave`) serves user bytes under a sandbox CSP.
  // Appending keeps that inert-content protection and adds our framing rule;
  // setting would have wiped the sandbox.
  let csp = sealed(
    new Response('bytes', {
      headers: { 'content-security-policy': "sandbox; script-src 'none'" },
    }),
  ).headers.get('content-security-policy')!
  assertStringIncludes(csp, "sandbox; script-src 'none'")
  assertStringIncludes(csp, "frame-ancestors 'self' https://yaks.app")
})

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
