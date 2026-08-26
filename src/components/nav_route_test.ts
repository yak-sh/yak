// The interceptor's route-shape predicate: `/` and one extensionless segment
// are the app's own routes; anything multi-segment or dotted is a real
// resource and keeps native navigation.
import { assertEquals } from '@std/assert'
import { appRoute } from './nav.tsx'

Deno.test('appRoute admits app routes and refuses resources', () => {
  for (let p of ['/', '/T-123', '/B-5', '/home', '/N-22368']) {
    assertEquals(appRoute(p), true, p)
  }
  for (
    let p of ['/blob/abc123', '/logs/x.jsonl', '/index.html', '/a/b', '/x.css']
  ) {
    assertEquals(appRoute(p), false, p)
  }
})
