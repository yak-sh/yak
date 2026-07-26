// Human-facing instruments use graph ids; browser clients keep their short
// handles.
import { assertEquals } from '@std/assert'
import { cache, ent } from '../live.ts'
import { author, prompt } from './Comments.tsx'

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

Deno.test('composer names an unnamed session by its chip id', () => {
  cache.value = {
    session: {
      entity: { eid: 'session', num: 31 },
      session: {
        eid: 'session',
        id: 'raw-session-uuid',
        origin: 'managed',
        provider_session_id: 'provider-session-uuid',
        status: 'completed',
        model: 'gpt-5.6',
      },
    },
  }
  assertEquals(prompt(ent('session')), 'send to S-31… (resumes the session)')
  cache.value = {}
})
