import {
  awake,
  cols,
  deaths,
  friendly,
  nick,
  type Session,
  settled,
  stamped,
  standing,
} from './types.ts'
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

Deno.test('friendly: the display face — caps back, dots back, pins off', () => {
  assertEquals(friendly('claude-opus-4-8'), 'Opus 4.8')
  assertEquals(friendly('claude-fable-5'), 'Fable 5')
  assertEquals(friendly('claude-haiku-4-5-20251001'), 'Haiku 4.5')
  assertEquals(friendly('opus'), 'Opus') // a short alias stays a word
  assertEquals(friendly('gpt-5.6-sol'), 'GPT 5.6 Sol')
  assertEquals(friendly('fake-fast'), 'Fake Fast')
  assertEquals(friendly(''), null)
  assertEquals(friendly(null), null)
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
      'knock.target_eid',
      'knock.to_eid',
      'wake.target_eid',
      'wake.to_eid',
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
      'memory.source_eid',
      'memory.scope_eid',
      'mail.target_eid',
      'mail.reply_to_eid',
      'created.by',
      'updated.by',
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

// The client's half of door.ts `listening()` — one predicate every surface
// shares (T-7461). Origin never enters it: an operator's own terminal is a
// session somebody is home in, and a managed row that ended is not.
let sess = (x: Partial<Session>): Session => ({ eid: 'e', id: 'i', ...x })

Deno.test('awake: a status says it, else an open door does', () => {
  assertEquals(awake(sess({ status: 'starting' })), true)
  assertEquals(awake(sess({ status: 'running' })), true)
  assertEquals(awake(sess({ status: 'stopping' })), true)
  // An ending stamps finished_at in the same breath as the status
  // (sessions.ts stamp()), so the two clauses never fight over a run.
  assertEquals(awake(sess({ status: 'completed', finished_at: 'x' })), false)
  assertEquals(awake(sess({ pid: 9 })), true) // an operator at the keyboard
  assertEquals(awake(sess({ pid: 9, finished_at: 'x' })), false) // a ghost
  assertEquals(awake(sess({})), false) // no pid, no run: no door
})

Deno.test('standing: an external session borrows the word from its door', () => {
  assertEquals(standing(sess({ status: 'completed' })), 'completed')
  assertEquals(standing(sess({ pid: 9 })), 'running')
  assertEquals(standing(sess({ pid: 9, finished_at: 'x' })), '') // dim again
  assertEquals(standing(sess({})), '')
})
