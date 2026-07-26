// Human-facing instruments use graph ids; browser clients keep their short
// handles.
import { assertEquals } from '@std/assert'
import { cache } from '../live.ts'
import { author } from './Comments.tsx'

Deno.test('author names a session by its chip id, never its harness uuid', () => {
  cache.value = {
    session: {
      entity: { eid: 'session', num: 31 },
      session: { eid: 'session', id: 'raw-session-uuid' },
    },
    client: {
      entity: { eid: 'client', num: 7 },
      client: { eid: 'client', user_agent: '', ip: '' },
    },
  }
  assertEquals(author('session'), 'S-31')
  assertEquals(author('client'), 'web-7')
  assertEquals(author(), 'anon')
  cache.value = {}
})
