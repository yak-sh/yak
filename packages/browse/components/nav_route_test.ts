// The interceptor's route-shape predicate: `/` and one extensionless segment
// are the app's own routes; anything multi-segment or dotted is a real
// resource and keeps native navigation.
import { test } from '@yaks/testing'
import '../testing.ts'
import { assertEquals } from '@std/assert'
import { appRoute } from './nav.tsx'

test('appRoute admits app routes and refuses resources', () => {
  for (let p of ['/', '/T-123', '/B-5', '/home', '/N-22368']) {
    assertEquals(appRoute(p), true, p)
  }
  for (
    let p of [
      '/blob/abc123',
      '/logs/x.jsonl',
      '/index.html',
      '/a/b',
      '/x.css',
      '/inspect',
    ]
  ) {
    assertEquals(appRoute(p), false, p)
  }
})

test('removed inspector route is not intercepted as an entity address', () => {
  let host = globalThis as { YAK_WEB?: import('../hosting.ts').Hosting }
  let prior = host.YAK_WEB
  host.YAK_WEB = {
    page: '/notes/_web',
    api: '/notes/api',
    apply: '/notes/api/apply',
    owner: '/notes/_web/owner',
  }
  try {
    assertEquals(appRoute('/inspect'), false)
    assertEquals(appRoute('/T-9'), true)
  } finally {
    host.YAK_WEB = prior
  }
})
