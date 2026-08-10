// Human-facing instruments use graph ids; browser clients keep their short
// handles.
import { assertEquals } from '@std/assert'
import { cache, ent } from '../live.ts'
import { byline, prompt, viaName } from './Comments.tsx'

Deno.test('viaName names a session by its chip id, never its harness uuid', () => {
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
  assertEquals(viaName('session'), 'S-31')
  assertEquals(viaName('client'), 'web-7')
  assertEquals(viaName(), 'anon')
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

Deno.test('byline reads actor and instrument from the created stamp', () => {
  cache.value = {
    actor: {
      entity: { eid: 'actor', num: 2 },
      doc: { eid: 'actor', title: 'jeff', body: '' },
      person: { eid: 'actor' },
    },
    session: {
      entity: { eid: 'session', num: 31 },
      session: { eid: 'session', id: 'raw-session-uuid' },
    },
    comment: {
      entity: { eid: 'comment', num: 9 },
      created: { eid: 'comment', at: '', by: 'actor', via: 'session' },
      comment: { eid: 'comment', target: 'target' },
    },
  }
  assertEquals(byline(ent('comment')), 'jeff · via S-31')
  cache.value = {}
})
