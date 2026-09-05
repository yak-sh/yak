// The route table as data: hostname + path in, (space, app, path) out.
import { assertEquals } from '@std/assert'
import {
  doorway,
  foreign,
  hostOf,
  onZone,
  ORIGIN,
  platform,
  route,
  sameOrigin,
  shared,
} from './route.ts'

let cases: [string, string, ReturnType<typeof route>][] = [
  ['yaks.app', '/', { space: null, app: null, path: '/' }],
  ['yaks.app', '/login', { space: null, app: null, path: '/login' }],
  ['yak.workers.dev', '/x', { space: null, app: null, path: '/x' }],
  ['127.0.0.1', '/', { space: null, app: null, path: '/' }],
  ['jeff.yaks.app', '/', { space: 'jeff', app: null, path: '/' }],
  ['jeff.yaks.app', '/recipes', { space: 'jeff', app: 'recipes', path: '' }],
  ['jeff.yaks.app', '/recipes/', { space: 'jeff', app: 'recipes', path: '/' }],
  ['jeff.yaks.app', '/recipes/api/query', {
    space: 'jeff',
    app: 'recipes',
    path: '/api/query',
  }],
  ['jeff.yaks.app', '/Not_A_Slug/x', {
    space: 'jeff',
    app: null,
    path: '/Not_A_Slug/x',
  }],
  // two levels down is nobody's space; neither is another domain
  ['a.b.yaks.app', '/', { space: null, app: null, path: '/' }],
  ['example.com', '/', { space: null, app: null, path: '/' }],
]

Deno.test('route: hostname and path name the space, app, and the rest', () => {
  for (let [host, path, want] of cases) {
    assertEquals(route(host, path), want, `${host}${path}`)
  }
})

Deno.test('hostOf: x-yak-host stands in on a dev host only', () => {
  let at = (url: string, host?: string) =>
    hostOf(new Request(url, { headers: host ? { 'x-yak-host': host } : {} }))
  assertEquals(at('http://127.0.0.1:8787/', 'Jeff.yaks.app'), 'jeff.yaks.app')
  assertEquals(at('http://yak.workers.dev/', 'jeff.yaks.app'), 'jeff.yaks.app')
  assertEquals(at('http://127.0.0.1:8787/'), '127.0.0.1')
  assertEquals(at('https://yaks.app/', 'jeff.yaks.app'), 'yaks.app')
  assertEquals(at('https://maya.yaks.app/', 'jeff.yaks.app'), 'maya.yaks.app')
})

// Which hostnames the directory is asked about at all (T-33037): only ones
// the platform does not already answer on, so every address that exists today
// is decided without a read.
Deno.test("foreign: someone else's hostname, and nothing of ours", () => {
  let cases: [string, boolean][] = [
    ['herbusiness.com', true],
    ['www.herbusiness.com', true],
    ['yaks.app', false],
    ['jeff.yaks.app', false],
    // Two levels down was the apex before custom domains and still is — and
    // it is where the fallback origin lives, so it is never a customer's.
    ['a.b.yaks.app', false],
    [ORIGIN, false],
    ['127.0.0.1', false],
    ['localhost', false],
    ['yak.workers.dev', false],
  ]
  for (let [host, want] of cases) assertEquals(foreign(host), want, host)
})

// The fallback origin is out of the space namespace by its SHAPE: `route`
// reads everything before `.yaks.app` as a slug, and no slug holds a dot, so
// no space can ever be minted that shadows our own origin.
Deno.test('the fallback origin is no space', () => {
  assertEquals(route(ORIGIN, '/'), { space: null, app: null, path: '/' })
})

// What a sign-in is allowed to hand someone back to (T-32593). A stranger's
// address is not one of ours however it is spelled.
Deno.test('onZone: our own https hostnames, and nothing else', () => {
  let ours: [string, string | null][] = [
    ['https://jeff.yaks.app/notes/', 'https://jeff.yaks.app/notes/'],
    ['https://yaks.app/', 'https://yaks.app/'],
    ['https://JEFF.yaks.app/x?a=1', 'https://jeff.yaks.app/x?a=1'],
    ['http://jeff.yaks.app/notes/', null],
    ['https://yaks.app.example.com/', null],
    // A custom domain is a place we SERVE and still not a place we send
    // anyone back to (T-33037): the session cookie is this zone's, and the
    // guard against an open redirect stays pure.
    ['https://herbusiness.com/', null],
    ['https://example.com/?to=https://yaks.app/', null],
    // A bare path is our own zone by construction — it is what the platform's
    // own returns are spelled as — while a path that starts a hostname is not
    // a path at all. `/\` is `//` to a browser.
    ['/notes/', '/notes/'],
    ['/', '/'],
    ['//jeff.yaks.app/notes/', null],
    ['/\\evil.example/', null],
    ['javascript:alert(1)', null],
    ['', null],
  ]
  for (let [href, want] of ours) assertEquals(onZone(href), want, href)
})

// Whose `/.well-known/` it is (route.ts `platform`): the place a site grants
// authority over its own name, so it belongs to whoever owns the name — us
// on `<space>.yaks.app`, the app on a domain of its own.
Deno.test("platform: a grant on our name is not an app's to make", () => {
  let owned: [string, string, boolean][] = [
    // Our own hostnames: the whole prefix, because a list of the names that
    // grant authority is a thing to forget.
    ['jeff.yaks.app', '/.well-known/acme-challenge/tok', true],
    ['jeff.yaks.app', '/.well-known/pki-validation/ca3-0052.txt', true],
    ['jeff.yaks.app', '/.well-known/assetlinks.json', true],
    ['jeff.yaks.app', '/.well-known/apple-app-site-association', true],
    ['jeff.yaks.app', '/.well-known/security.txt', true],
    ['jeff.yaks.app', '/.well-known/', true],
    ['yaks.app', '/.well-known/openai-apps-challenge', true],
    // identity.ts's own metadata is under the prefix too, and stays its
    // door's: the apex answers what it owns (index.ts).
    ['yaks.app', '/.well-known/oauth-authorization-server', true],
    // A grant is read at the ROOT, so the same name under an app's own
    // prefix is that app's file and stays it.
    ['jeff.yaks.app', '/site/.well-known/acme-challenge/tok', false],
    // `robots.txt` is about the whole host and grants nobody anything, so it
    // is the app's — the line is authority, not scope.
    ['jeff.yaks.app', '/robots.txt', false],
    ['jeff.yaks.app', '/', false],
    // A customer's own domain is one app's outright, so the whole prefix is
    // the app's — no carve-out. Proving domain control to a third party,
    // Apple Pay's merchant association, App Links, `security.txt`: all of it
    // is what a domain is FOR, and our own renewal never depends on it,
    // because Cloudflare's edge answers a CA before this Worker runs.
    ['herbusiness.com', '/.well-known/acme-challenge/tok', false],
    ['herbusiness.com', '/.well-known/pki-validation/ca3-0052.txt', false],
    ['herbusiness.com', '/.well-known/assetlinks.json', false],
    [
      'herbusiness.com',
      '/.well-known/apple-developer-merchantid-domain-association',
      false,
    ],
    ['herbusiness.com', '/.well-known/security.txt', false],
  ]
  for (let [host, path, want] of owned) {
    assertEquals(platform(host, path), want, `${host}${path}`)
  }
})

// Which paths the origin check guards (route.ts `doorway`): everywhere the
// graph answers, and nowhere an app's own bytes do.
Deno.test('doorway: the graph doors, not the pages', () => {
  let doors: [string, boolean][] = [
    ['/recipes/api/apply', true],
    ['/recipes/api/ws', true],
    ['/recipes/api/blob', true],
    ['/recipes/api/files/index.html', true],
    // A front page's own door, at a space's bare hostname (apps.ts `fetch`),
    // and a custom domain's, which is that same address before the router
    // rewrites it (index.ts `aimed`).
    ['/api/apply', true],
    ['/mcp', true],
    ['/', false],
    ['/recipes/', false],
    ['/recipes/api', false],
    ['/recipes/apiary/x', false],
    ['/recipes/photo.png', false],
    ['/mcpx', false],
  ]
  for (let [path, want] of doors) assertEquals(doorway(path), want, path)
})

// The line between spaces (route.ts `sameOrigin`). Sibling spaces are
// same-site, so nothing but this tells them apart; an absent header is a
// client with no page behind it and keeps its door.
Deno.test('sameOrigin: the page that asked, at the host it asked', () => {
  let asked: [string, string | null, boolean][] = [
    ['jeff.yaks.app', null, true],
    ['jeff.yaks.app', 'https://jeff.yaks.app', true],
    ['jeff.yaks.app', 'https://JEFF.yaks.app', true],
    // A dev host talks http on a port, and neither is what isolates a space.
    ['jeff.yaks.app', 'http://jeff.yaks.app:8787', true],
    ['jeff.yaks.app', 'https://evil.yaks.app', false],
    ['jeff.yaks.app', 'https://yaks.app', false],
    ['jeff.yaks.app', 'https://jeff.yaks.app.example.com', false],
    ['jeff.yaks.app', 'https://example.com', false],
    // A sandboxed frame's opaque origin is a stranger, not an absence.
    ['jeff.yaks.app', 'null', false],
    ['jeff.yaks.app', 'not an origin', false],
    // A customer's own hostname, asking its own app's door (T-33037).
    ['herbusiness.com', 'https://herbusiness.com', true],
    ['herbusiness.com', 'https://evil.yaks.app', false],
  ]
  for (let [host, origin, want] of asked) {
    assertEquals(sameOrigin(host, origin), want, `${host} <- ${origin}`)
  }
})

// The one exception to it (route.ts `shared`): the read door, asked with GET.
// Everything a write could ride on is outside — including `/ws`, which reads
// but carries the write grant on the same socket.
Deno.test('shared: the read door, and nothing a write could ride on', () => {
  let doors: [string, string, boolean][] = [
    ['GET', '/recipes/api/query', true],
    ['HEAD', '/recipes/api/query', true],
    // A front page's own door, and a custom domain's before the rewrite.
    ['GET', '/api/query', true],
    ['POST', '/recipes/api/query', false],
    ['GET', '/recipes/api/apply', false],
    ['GET', '/recipes/api/ws', false],
    ['GET', '/recipes/api/graph', false],
    ['GET', '/recipes/api/me', false],
    ['GET', '/recipes/api/blob', false],
    ['GET', '/recipes/api/files/index.html', false],
    ['GET', '/mcp', false],
    // Not a door at all, and not this one's to open.
    ['GET', '/recipes/api/query/deeper', false],
    ['GET', '/a/b/api/query', false],
    ['GET', '/recipes/', false],
  ]
  for (let [method, path, want] of doors) {
    assertEquals(shared(method, path), want, `${method} ${path}`)
  }
})
