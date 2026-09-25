import './testing.ts'
import {
  awake,
  cols,
  comps,
  deaths,
  friendly,
  nick,
  type Session,
  settled,
  stamped,
  standing,
  statusOf,
} from './types.ts'
import { assertEquals } from '@std/assert'

Deno.test('the current vocabulary carries no representation suffixes', () => {
  for (let [comp, props] of Object.entries({ ...comps, ...stamped })) {
    for (let prop of Object.keys(props)) {
      assertEquals(prop.endsWith('_eid'), false, `${comp}.${prop}`)
    }
  }
})

// The death words come from the host's vocabulary, one per reference: a
// delete guard reads the cascade set, so a word lost in learning is a delete
// that says less than it will do.
Deno.test("death words: each reference carries its plugin's word", () => {
  let words = (w: Parameters<typeof deaths>[0]) =>
    new Set(deaths(w).map(([c, p]) => `${c}.${p}`))
  assertEquals(words('cascade').has('card.target'), true)
  assertEquals(words('cascade').has('edge.from'), true)
  assertEquals(words('detach').has('filed.project'), true)
  assertEquals(words('release').has('claim.session'), true)
  assertEquals(words('keep').has('mail.target'), true)
})

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
  assertEquals(friendly('sonnet'), 'Sonnet') // a short alias stays a word
  assertEquals(friendly('gpt-5.6-sol'), 'GPT 5.6 Sol')
  assertEquals(friendly('fake-fast'), 'Fake Fast')
  assertEquals(friendly(''), null)
  assertEquals(friendly(null), null)
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

// The marks are the evidence; a materialized `task.status` is the floor under
// them. An edge rider's peer arrives PROJECTED — spine, kind, and the columns
// `.edges.peers=task.status,doc.title` named — so it carries the derived value
// and none of the comps it was derived from; reading marks alone painted every
// done dependency as open on its parent's card.
Deno.test('statusOf: marks first, a projected task.status beneath them', () => {
  let cases: [Record<string, unknown>, string][] = [
    [{ task: {} }, 'open'],
    [{ task: {}, completed: {} }, 'done'],
    [{ task: {}, cancelled: {} }, 'cancelled'],
    [{ task: {}, claim: {} }, 'wip'],
    // A peer: the projection, no marks.
    [{ task: { status: 'done' } }, 'done'],
    [{ task: { status: 'cancelled' } }, 'cancelled'],
    [{ task: { status: 'wip' } }, 'wip'],
    [{ task: { status: 'open' } }, 'open'],
    // Both: the row's own evidence beats an older projected snapshot.
    [{ task: { status: 'open' }, completed: {} }, 'done'],
    [{ task: { status: 'done' }, cancelled: {} }, 'cancelled'],
  ]
  for (let [has, want] of cases) {
    assertEquals(statusOf(has), want, JSON.stringify(has))
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

// The client's half of door.ts `present()` — one predicate every surface
// shares (T-7461). Origin never enters it: an operator's own terminal is a
// session somebody is home in, and a managed row that ended is not.
let sess = (x: Partial<Session>): Session => ({ eid: 'e', id: 'i', ...x })

Deno.test('awake: a status says it, else an open door does', () => {
  assertEquals(awake(sess({ status: 'pending' })), true)
  assertEquals(awake(sess({ status: 'running' })), true)
  assertEquals(awake(sess({ status: 'settled' })), false)
  assertEquals(awake(sess({ status: 'stopped', finished_at: 'x' })), false)
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

Deno.test('standing: an awake idle turn rests without hiding its ending', () => {
  assertEquals(standing(sess({ status: 'running', turn: 'idle' })), 'idle')
  assertEquals(standing(sess({ pid: 9, turn: 'idle' })), 'idle')
  assertEquals(
    standing(sess({ status: 'completed', turn: 'idle', finished_at: 'x' })),
    'completed',
  )
})
