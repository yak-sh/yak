import { assertEquals, assertNotEquals } from '@std/assert'
import { addressed, representation, represents } from './representation.ts'

Deno.test('representation identity includes scope, type, and filename', () => {
  let sha = 'a'.repeat(64)
  let first = representation('app-a', sha, 'audio/MPEG', 'Travel.mp3')
  assertEquals(first, representation('app-a', sha, 'audio/mpeg', 'Travel.mp3'))
  assertNotEquals(first.eid, representation('app-b', sha, 'audio/mpeg').eid)
  assertNotEquals(first.eid, representation('app-a', sha, 'text/plain').eid)
  assertNotEquals(
    first.eid,
    representation('app-a', sha, 'audio/mpeg', 'song.mp3').eid,
  )
  assertEquals(represents(first.eid, first.row), true)
  assertEquals(represents(first.eid, { ...first.row, scope: 'app-b' }), false)
  assertEquals(addressed(first.path), { sha, eid: first.eid })
  assertEquals(addressed(sha)?.sha, sha)
  assertEquals(addressed(sha)?.eid, null)
  assertEquals(addressed(`${sha}/../${first.eid}`), null)
})
