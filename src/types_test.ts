import { cols, deaths, nick, settled, stamped } from './types.ts'
import { assertEquals } from '@std/assert'

Deno.test('nick: the model word, vendor and versions dropped', () => {
  assertEquals(nick('claude-fable-5'), 'fable')
  assertEquals(nick('claude-opus-4-8'), 'opus')
  assertEquals(nick('claude-haiku-4-5-20251001'), 'haiku')
  assertEquals(nick('gpt-5.6-sol'), 'sol')
  assertEquals(nick('gpt-5.6-terra'), 'terra')
  assertEquals(nick(''), null)
  assertEquals(nick(null), null)
  assertEquals(nick('claude-3'), null) // nothing left to call it
})

// Pin the derivation to what db.ts's hand-kept AIMED and soft-detach
// lists used to say — plus the words those lists never had: sessions
// detach from a dead task/persona (the T-3685 gap), a dead client's
// shelf releases, bylines and memory provenance keep.
Deno.test('death words: every reference declares, the sets hold', () => {
  let words = (w: Parameters<typeof deaths>[0]) =>
    new Set(deaths(w).map(([c, p]) => `${c}.${p}`))
  assertEquals(
    words('cascade'),
    new Set([
      'card.target_eid',
      'comment.target_eid',
      'stop_request.target_eid',
      'pin.canvas_eid',
      'camera.client_eid',
      'camera.canvas_eid',
      'fold.client_eid',
      'fold.board_eid',
    ]),
  )
  assertEquals(
    words('detach'),
    new Set([
      'task.project_eid',
      'task.assignee_eid',
      'client.actor_eid',
      'session.actor_eid',
      'session.requested_task_eid',
      'session.persona_eid',
      'persona.home_eid',
    ]),
  )
  assertEquals(
    words('release'),
    new Set(['claim.session_eid', 'shelf.client_eid']),
  )
  assertEquals(
    words('keep'),
    new Set([
      'comment.author_eid',
      'memory.source_eid',
      'memory.scope_eid',
      'mail.target_eid',
    ]),
  )
})

// The declared stamped columns must never leak into the wire allowlist —
// cols() reads comps alone, and this holds it to that.
Deno.test('stamped: declared, and still not wire-writable', () => {
  for (let [comp, props] of Object.entries(stamped)) {
    for (let col of Object.keys(props)) {
      assertEquals(
        cols(comp).includes(col),
        false,
        `${comp}.${col} leaked into the allowlist`,
      )
    }
  }
})

Deno.test('settled: done or cancelled, nothing else', () => {
  assertEquals(settled('done'), true)
  assertEquals(settled('cancelled'), true)
  assertEquals(settled('open'), false)
  assertEquals(settled('wip'), false)
  assertEquals(settled(null), false)
  assertEquals(settled(undefined), false)
})
