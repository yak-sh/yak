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
  ({ s1: 'S-1', t9: 'T-9', p1: 'P-1' } as Record<string, string>)[eid] ?? null

let ctx = (over: Partial<Ctx> = {}): Ctx => ({
  sessionEid: 'sess',
  actorEid: 'actor',
  idOf,
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

Deno.test('findSession resolves the served session by its id', () => {
  let batch = [
    ch('e9', 'session', { id: 'other', actor_eid: 'x' }),
    ch('e1', 'session', { id: 'wanted', actor_eid: 'p1' }),
  ]
  assertEquals(findSession(batch, 'wanted'), { eid: 'e1', actorEid: 'p1' })
  assertEquals(findSession(batch, 'missing'), undefined)
})

// --- sanitization ------------------------------------------------------------

Deno.test('cleanAttr collapses newlines and drops tag-breaking chars', () => {
  assertEquals(cleanAttr('a\nb"<>c'), 'a bc')
})

Deno.test('cleanBody strips control bytes but keeps newlines and tabs', () => {
  assertEquals(cleanBody('line1\n\tline2\x00\x07'), 'line1\n\tline2')
})
