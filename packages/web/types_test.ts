import './testing.ts'
import {
  awake,
  cols,
  comps,
  deaths,
  friendly,
  type Life,
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
  // Every reference says one, and the four words leave none over.
  let refs = Object.entries(comps).flatMap(([c, props]) =>
    Object.entries(props).flatMap(([p, t]) =>
      typeof t == 'object' && 'eid' in t ? [`${c}.${p}`] : []
    )
  )
  let all = (['cascade', 'detach', 'release', 'keep'] as const)
    .flatMap((w) => [...words(w)])
  assertEquals(all.toSorted(), refs.toSorted())
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

// A session is awake while its transcript asks for work, or while a
// harness session's process runs; standing is the word its pip wears.
let sess = (x: Partial<Session> = {}, more: Omit<Life, 'session'> = {}) => ({
  session: { eid: 'e', id: 'i', ...x },
  ...more,
})
let pid = { process: { eid: 'e', pid: 9 } }
let exited = { ...pid, exit: { eid: 'e', code: 0 } }

Deno.test('awake: a status says it, else a live process does', () => {
  assertEquals(awake(sess({ status: 'pending' })), true)
  assertEquals(awake(sess({ status: 'running' })), true)
  assertEquals(awake(sess({ status: 'settled' })), false)
  assertEquals(awake(sess({ status: 'stopped' }, exited)), false)
  assertEquals(awake(sess({}, pid)), true) // a harness session at work
  assertEquals(awake(sess({}, exited)), false) // a ghost
  assertEquals(awake(sess()), false)
})

Deno.test('standing: the status, else running while only a process says so', () => {
  assertEquals(standing(sess({ status: 'failed' })), 'failed')
  assertEquals(standing(sess({}, pid)), 'running')
  assertEquals(standing(sess({}, exited)), '')
  assertEquals(standing(sess()), '')
})

Deno.test('standing: an awake idle turn rests without hiding its ending', () => {
  assertEquals(standing(sess({ status: 'running', standing: 'idle' })), 'idle')
  assertEquals(standing(sess({ standing: 'idle' }, pid)), 'idle')
  assertEquals(
    standing(sess({ status: 'settled', standing: 'idle' })),
    'settled',
  )
})
