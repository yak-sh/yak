// The tasks channel's pure seam — the filter (which broadcast changes are aimed
// at a session) and the format (how each renders as a channel event), proven
// without a socket or an MCP pipe. Run: deno test -A channels/tasks/.
import { assertEquals } from '@std/assert'
import type { Change } from '../../src/types.ts'
import {
  channelEvents,
  cleanAttr,
  cleanBody,
  type Ctx,
  docOf,
  findSession,
  humanId,
  type Index,
  learn,
} from './filter.ts'

let ch = (
  eid: string,
  name: string,
  comp: Record<string, unknown> | null,
): Change => ({ eid, name, comp })

// A stub id book — the socket-fed index is exercised separately (learn tests).
let idOf = (eid: string): string | null =>
  ({ s1: 'S-1', t9: 'T-9', p1: 'P-1', m1: 'E-5' } as Record<string, string>)[
    eid
  ] ?? null

let ctx = (over: Partial<Ctx> = {}): Ctx => ({
  sessionEid: 'sess',
  actorEid: 'actor',
  homeEid: 'home',
  idOf,
  seen: new Set(),
  ...over,
})

// --- comments ----------------------------------------------------------------

Deno.test('a comment on the session emits with its words and author id', () => {
  let batch = [
    ch('c1', 'doc', { title: '', body: 'ping' }),
    ch('c1', 'comment', { target_eid: 'sess', author_eid: 's1' }),
  ]
  assertEquals(channelEvents(batch, ctx()), [
    { content: 'ping', meta: { kind: 'comment', from: 'S-1' } },
  ])
})

Deno.test('a comment mint with no doc in the batch is skipped (bodiless)', () => {
  let batch = [ch('c1', 'comment', { target_eid: 'sess', author_eid: 's1' })]
  assertEquals(channelEvents(batch, ctx()), [])
})

Deno.test('a comment aimed elsewhere is ignored', () => {
  let batch = [
    ch('c1', 'doc', { title: '', body: 'ping' }),
    ch('c1', 'comment', { target_eid: 'other', author_eid: 's1' }),
  ]
  assertEquals(channelEvents(batch, ctx()), [])
})

Deno.test('a comment on a CLAIMED task is delivered, naming the task', () => {
  let batch = [
    ch('c1', 'doc', { title: '', body: 'take a look' }),
    ch('c1', 'comment', { target_eid: 't9', author_eid: 's1' }),
  ]
  assertEquals(channelEvents(batch, ctx({ claimedEids: new Set(['t9']) })), [
    {
      content: 'take a look',
      meta: { kind: 'comment', from: 'S-1', on: 'T-9' },
    },
  ])
})

Deno.test('a comment on an UNCLAIMED task is dropped', () => {
  let batch = [
    ch('c1', 'doc', { title: '', body: 'not for you' }),
    ch('c1', 'comment', { target_eid: 't9', author_eid: 's1' }),
  ]
  // The session holds a different task, so t9 is foreign.
  assertEquals(
    channelEvents(batch, ctx({ claimedEids: new Set(['other']) })),
    [],
  )
})

Deno.test('an unresolvable author renders as unknown', () => {
  let batch = [
    ch('c1', 'doc', { title: '', body: 'hey' }),
    ch('c1', 'comment', { target_eid: 'sess', author_eid: 'zzz' }),
  ]
  assertEquals(channelEvents(batch, ctx())[0].meta.from, 'unknown')
})

Deno.test('a comment falls back to its title when the body is empty', () => {
  let batch = [
    ch('c1', 'doc', { title: 'subject only', body: '' }),
    ch('c1', 'comment', { target_eid: 'sess', author_eid: 's1' }),
  ]
  assertEquals(channelEvents(batch, ctx())[0].content, 'subject only')
})

// --- knocks ------------------------------------------------------------------

Deno.test('a knock at the session names its target as a human id', () => {
  let batch = [ch('k1', 'knock', { to_eid: 'sess', target_eid: 't9' })]
  assertEquals(channelEvents(batch, ctx()), [
    { content: 'knock: look at T-9', meta: { kind: 'knock' } },
  ])
})

Deno.test('a knock at the session actor is delivered too', () => {
  let batch = [ch('k1', 'knock', { to_eid: 'actor', target_eid: 't9' })]
  assertEquals(channelEvents(batch, ctx())[0].content, 'knock: look at T-9')
})

Deno.test('a knock naming only its recipient has no look-at target', () => {
  let batch = [ch('k1', 'knock', { to_eid: 'sess' })]
  assertEquals(channelEvents(batch, ctx()), [
    { content: 'knock', meta: { kind: 'knock' } },
  ])
})

Deno.test('a knock carries the words of the comment on its TARGET', () => {
  let batch = [
    ch('k1', 'knock', { to_eid: 'sess', target_eid: 't9' }),
    ch('c1', 'doc', { title: '', body: 'take a look' }),
    ch('c1', 'comment', { target_eid: 't9', author_eid: 's1' }),
  ]
  let out = channelEvents(batch, ctx())
  assertEquals(out, [{
    content: 'knock: look at T-9 — take a look',
    meta: { kind: 'knock' },
  }])
})

Deno.test('a knock aimed at neither the session nor its actor is ignored', () => {
  let batch = [ch('k1', 'knock', { to_eid: 'stranger', target_eid: 't9' })]
  assertEquals(channelEvents(batch, ctx()), [])
})

Deno.test("the resolver's stamp re-broadcast is a receipt, not a nudge", () => {
  let batch = [ch('k1', 'knock', {
    to_eid: 'sess',
    target_eid: 't9',
    acted_at: 1234,
    delivery: 'cast S-1',
  })]
  assertEquals(channelEvents(batch, ctx()), [])
})

// --- mail --------------------------------------------------------------------
// The arrival signal is the sweep's full-row stamp broadcast: a bare `mail`
// change carrying received_at (server-only, never on a wire patch). The doc
// rides an EARLIER frame (a mint) or the boot snapshot (an echo), so the words
// come from ctx.docOf.

let stamp = (over: Record<string, unknown> = {}) =>
  ch('m1', 'mail', {
    to: 'taskmaster@bot.yak.sh',
    from: 'jeff@yak.sh',
    target_eid: 'home',
    message_id: 'msg:1:x',
    received_at: '2026-07-22T00:00:00Z',
    verified: 1,
    read_at: null,
    ...over,
  })

let letter = () => ({ title: 'hello', body: 'a letter' })

Deno.test('a verified unread mail for the home project injects', () => {
  let out = channelEvents([stamp()], ctx({ docOf: () => letter() }))
  assertEquals(out, [{
    content: 'a letter',
    meta: {
      kind: 'mail',
      from: 'jeff@yak.sh',
      auth: 'VERIFIED',
      subj: 'hello',
      id: 'E-5',
    },
  }])
})

Deno.test('unverified mail never injects — it waits for triage', () => {
  let out = channelEvents([stamp({ verified: 0 })], ctx({ docOf: letter }))
  assertEquals(out, [])
})

Deno.test('mail already opened/archived is not re-announced', () => {
  let batch = [stamp()]
  let seen = ctx({ docOf: letter, done: () => true })
  assertEquals(channelEvents(batch, seen), [])
})

Deno.test("mail aimed at another project isn't this session's", () => {
  let batch = [stamp({ target_eid: 'elsewhere' })]
  assertEquals(channelEvents(batch, ctx({ docOf: letter })), [])
})

Deno.test('no resolved home project, no mail delivery', () => {
  let batch = [stamp()]
  assertEquals(channelEvents(batch, ctx({ homeEid: null, docOf: letter })), [])
})

Deno.test("a mint's wire frame (no received_at) is not the arrival", () => {
  let batch = [
    ch('m1', 'doc', { title: 'hello', body: 'a letter' }),
    ch('m1', 'mail', { to: 'x@y', from: 'jeff@yak.sh', target_eid: 'home' }),
  ]
  assertEquals(channelEvents(batch, ctx()), [])
})

Deno.test('an echo arrival with no doc anywhere falls back to a pointer', () => {
  let out = channelEvents([stamp()], ctx())
  assertEquals(out[0].content, 'mail E-5 from jeff@yak.sh — task mail show E-5')
  assertEquals(out[0].meta, {
    kind: 'mail',
    from: 'jeff@yak.sh',
    auth: 'VERIFIED',
    id: 'E-5',
  })
})

Deno.test('a full-row re-broadcast does not ring twice', () => {
  let c = ctx({ docOf: letter })
  assertEquals(channelEvents([stamp()], c).length, 1)
  assertEquals(channelEvents([stamp()], c), [])
})

Deno.test("learn caches a mail's doc for the stamp frame that follows", () => {
  let idx: Index = new Map()
  learn(idx, [
    ch('m1', 'entity', { num: 5 }),
    // doc BEFORE mail in the same batch — the second pass still catches it.
    ch('m1', 'doc', { title: 'hello', body: 'a letter' }),
    ch('m1', 'mail', { to: 'x@y', from: 'jeff@yak.sh', target_eid: 'home' }),
  ])
  assertEquals(docOf(idx, 'm1'), { title: 'hello', body: 'a letter' })
  let out = channelEvents([stamp()], ctx({ docOf: (e) => docOf(idx, e) }))
  assertEquals(out[0].content, 'a letter')
})

Deno.test('a doc patch on a cached mail merges only what it carries', () => {
  let idx: Index = new Map()
  learn(idx, [
    ch('m1', 'doc', { title: 'hello', body: 'a letter' }),
    ch('m1', 'mail', { to: 'x@y' }),
  ])
  learn(idx, [ch('m1', 'doc', { body: 'edited' })])
  assertEquals(docOf(idx, 'm1'), { title: 'hello', body: 'edited' })
  assertEquals(docOf(idx, 'ghost'), null)
})

// --- identity ----------------------------------------------------------------

Deno.test('learn + humanId derive a human id from spine and components', () => {
  let idx: Index = new Map()
  learn(idx, [
    ch('e1', 'entity', { num: 31 }),
    ch('e1', 'session', { id: 'x' }),
    ch('e2', 'entity', { num: 9 }),
    ch('e2', 'doc', {}),
    ch('e2', 'task', {}),
  ])
  assertEquals(humanId(idx, 'e1'), 'S-31') // session prefix
  assertEquals(humanId(idx, 'e2'), 'T-9') // doc+task = task
  assertEquals(humanId(idx, 'ghost'), null) // never seen
})

Deno.test('learn forgets a tombstoned entity', () => {
  let idx: Index = new Map()
  learn(idx, [ch('e1', 'entity', { num: 5 }), ch('e1', 'doc', {})])
  learn(idx, [ch('e1', 'entity', null)])
  assertEquals(humanId(idx, 'e1'), null)
})

Deno.test('learn drops a component when its patch clears it', () => {
  let idx: Index = new Map()
  learn(idx, [ch('e1', 'entity', { num: 7 }), ch('e1', 'task', {})])
  learn(idx, [ch('e1', 'task', null)])
  assertEquals(humanId(idx, 'e1'), 'E-7') // no components → kind 'entity', capitalized initial
})

Deno.test('findSession resolves by the claude pid', () => {
  let batch = [
    ch('e9', 'session', { id: 'other', pid: 111, actor_eid: 'x' }),
    ch('e1', 'session', {
      id: 'mine',
      pid: 4242,
      actor_eid: 'p1',
      persona_eid: 'n1',
    }),
  ]
  assertEquals(findSession(batch, { pid: 4242 }), {
    eid: 'e1',
    actorEid: 'p1',
    personaEid: 'n1',
  })
  assertEquals(findSession(batch, { pid: 999 }), undefined)
})

Deno.test('findSession: the LAST same-pid session wins — /clear rotates forward', () => {
  let batch = [
    ch('old', 'session', { id: 'before-clear', pid: 4242 }),
    ch('new', 'session', { id: 'after-clear', pid: 4242 }),
  ]
  assertEquals(findSession(batch, { pid: 4242 })?.eid, 'new')
})

Deno.test('findSession: a pid match outranks the boot id hint', () => {
  let batch = [
    ch('hinted', 'session', { id: 'boot-id' }),
    ch('mine', 'session', { id: 'rotated-id', pid: 4242 }),
  ]
  assertEquals(findSession(batch, { pid: 4242, id: 'boot-id' })?.eid, 'mine')
})

Deno.test('findSession falls back to the boot id when no pid stamp exists', () => {
  let batch = [ch('e1', 'session', { id: 'boot-id', actor_eid: 'p1' })]
  assertEquals(findSession(batch, { pid: 4242, id: 'boot-id' }), {
    eid: 'e1',
    actorEid: 'p1',
    personaEid: undefined,
  })
  assertEquals(findSession(batch, { id: 'missing' }), undefined)
})

Deno.test('findSession: a patch on the resolved eid keeps the actor fresh', () => {
  let batch = [ch('e1', 'session', { actor_eid: 'p1' })]
  assertEquals(findSession(batch, { pid: 4242, eid: 'e1' }), {
    eid: 'e1',
    actorEid: 'p1',
    personaEid: undefined,
  })
})

// --- sanitization ------------------------------------------------------------

Deno.test('cleanAttr collapses newlines and drops tag-breaking chars', () => {
  assertEquals(cleanAttr('a\nb"<>c'), 'a bc')
})

Deno.test('cleanBody strips control bytes but keeps newlines and tabs', () => {
  assertEquals(cleanBody('line1\n\tline2\x00\x07'), 'line1\n\tline2')
})
