/// <reference lib="deno.ns" />
// The death cascade, asked of a database rather than walked. @yaks/graph owns
// what a death word MEANS; this adapter answers who it reaches, as one
// recursive statement (@yaks/sql's `doomSql`/`looseSql`). The two must not
// disagree, so every case here is applied to a graph over SQLite AND to a graph
// over a Map — which has no statement to compile and is walked instead — and
// the two answers are compared.
//
// The vocabulary is a bare skeleton on purpose: a node that exists about
// another node (so a chain is expressible, and so is a cycle), and one soft
// reference of each word.
//
// A SECOND vocabulary is WIDE — more tables bearing a cascade column than one
// compound SELECT may carry (@yaks/sql `ARMS`) — because that is the shape the
// platform's own vocabulary has, and the shape that cannot be said in one
// statement. Its cascade is asked in rounds instead, and a chain that
// alternates between the two halves is what proves the rounds are run to a
// fixed point rather than once.

import { assert, assertEquals } from '@std/assert'
import { ARMS, doomSql, looseSql, narrow } from '@yaks/sql'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { type Bundle, type Change, type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { mem } from './harness.ts'
import { storage, type Store } from './mod.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    // A node exists ABOUT another node: deleting one takes it with it, however
    // long the chain of them is.
    node: {
      type: 'object',
      kind: true,
      properties: {
        name: { type: 'string' },
        of: { type: 'string', ref: 'entity', death: 'cascade' },
      },
    },
    // The row's whole reason to exist is the reference.
    mark: {
      type: 'object',
      properties: {
        at: { type: 'string', ref: 'entity', death: 'release' },
      },
    },
    // The reference is one fact among others: it is nulled, the row stays.
    link: {
      type: 'object',
      properties: {
        to: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
  },
}

let words: Vocab = loadVocab(doc)

// Six tables bearing a cascade column, which is two statements' worth: `n1..n4`
// in the first, `n5`/`n6` in the second. One soft reference, so the survivors
// are answered after the closure has settled rather than during it.
let wide: Vocab = loadVocab({
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    ...Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((i) => [`n${i}`, {
        type: 'object',
        properties: {
          of: { type: 'string', ref: 'entity', death: 'cascade' },
        },
      }]),
    ),
    mark: {
      type: 'object',
      properties: {
        at: { type: 'string', ref: 'entity', death: 'release' },
      },
    },
  } as VocabDoc['$defs'],
})

let AT = '2026-03-01T00:00:00.000Z'

let db = (v: Vocab = words): Store => {
  let s = storage(mem(), v)
  s.install()
  return s
}

// The same batches through a graph over SQLite and a graph over a Map: what
// the last one answered, asserted equal. The compiled closure and the walk are
// the same rule or one of them is wrong.
let both = (seed: Change, kill: Change, v: Vocab = words): Bundle[] => {
  let run = (g: Graph): Bundle[] => {
    g.apply(seed, { now: AT })
    return g.apply(kill, { now: AT }) as Bundle[]
  }
  let sql = run(graph({ storage: db(v), vocab: v }))
  assertEquals(sql, run(graph({ storage: ram(v), vocab: v })))
  return sql
}

let dead = (out: Bundle[]): string[] =>
  out.filter((b) => b.tombstone != null).map((b) => b.entity.eid)

Deno.test('a chain falls to the end, rung by rung', () => {
  let out = both([
    { entity: { eid: 'a' }, node: { name: 'a' } },
    { entity: { eid: 'b' }, node: { name: 'b', of: 'a' } },
    { entity: { eid: 'c' }, node: { name: 'c', of: 'b' } },
    { entity: { eid: 'd' }, node: { name: 'd', of: 'c' } },
    { entity: { eid: 'z' }, node: { name: 'z' } },
  ], [{ entity: { eid: 'a' }, $delete: true }])
  // The named dead leads, then the rungs in order, and the bystander is
  // untouched. Every death is spelled `tombstone` in the answer, the batch's
  // own included: `$delete` is the pipeline's word and stops there
  // (@yaks/graph `composed`).
  assertEquals(dead(out), ['a', 'b', 'c', 'd'])
})

Deno.test('a fork takes both arms, and stops at what points nowhere', () => {
  let out = both([
    { entity: { eid: 'a' }, node: { name: 'a' } },
    { entity: { eid: 'b' }, node: { name: 'b', of: 'a' } },
    { entity: { eid: 'c' }, node: { name: 'c', of: 'a' } },
    { entity: { eid: 'd' }, node: { name: 'd', of: 'b' } },
  ], [{ entity: { eid: 'a' }, $delete: true }])
  assertEquals(dead(out), ['a', 'b', 'c', 'd'])
})

Deno.test('a cycle of cascade references terminates', () => {
  // Two nodes that each exist about the other. The walk stops on a repeat and
  // the statement's rung count saturates, so neither runs forever.
  let out = both([
    { entity: { eid: 'x' }, node: { name: 'x' } },
    { entity: { eid: 'y' }, node: { name: 'y', of: 'x' } },
    { entity: { eid: 'x' }, node: { of: 'y' } },
  ], [{ entity: { eid: 'x' }, $delete: true }])
  assertEquals(dead(out), ['x', 'y'])
})

Deno.test('only survivors let go', () => {
  let out = both([
    { entity: { eid: 'a' }, node: { name: 'a' } },
    { entity: { eid: 'b' }, node: { name: 'b', of: 'a' } },
    // A survivor marking the dead, and one marking a casualty.
    { entity: { eid: 'm1' }, mark: { at: 'a' } },
    { entity: { eid: 'm2' }, mark: { at: 'b' } },
    { entity: { eid: 'l1' }, link: { to: 'a' } },
    // A casualty's own soft reference: it dies, so it is never told to let go.
    { entity: { eid: 'c' }, node: { name: 'c', of: 'a' }, mark: { at: 'a' } },
  ], [{ entity: { eid: 'a' }, $delete: true }])
  assertEquals(
    out.filter((b) => b.mark !== undefined || b.link !== undefined),
    [
      { entity: { eid: 'm1' }, mark: null },
      { entity: { eid: 'm2' }, mark: null },
      { entity: { eid: 'l1' }, link: { to: null } },
    ],
  )
  assertEquals(dead(out), ['a', 'b', 'c'])
})

Deno.test('the closure carries the rung it fell on', () => {
  let s = db()
  s.tx((tx) =>
    tx.patch([
      { entity: { eid: 'a' }, node: { name: 'a' } },
      { entity: { eid: 'b' }, node: { name: 'b', of: 'a' } },
      { entity: { eid: 'c' }, node: { name: 'c', of: 'b' } },
      { entity: { eid: 'm' }, mark: { at: 'c' } },
    ])
  )
  assertEquals(
    s.tx((tx) => tx.doom(['a'])),
    {
      gone: [
        { eid: 'a', depth: 0 },
        { eid: 'b', depth: 1 },
        { eid: 'c', depth: 2 },
      ],
      loose: [{ eid: 'm', comp: 'mark', prop: 'at' }],
    },
  )
})

Deno.test('a chain longer than the rung count still falls whole', () => {
  // Past @yaks/sql's DEEP the rung number saturates rather than climbing — the
  // count is what stops, never the walk. A chain twice that long proves it.
  let s = db()
  let n = 80
  s.tx((tx) =>
    tx.patch(
      Array.from({ length: n }, (_, i) => ({
        entity: { eid: `n${i}` },
        node: { name: `n${i}`, ...(i ? { of: `n${i - 1}` } : {}) },
      })),
    )
  )
  let gone = s.tx((tx) => tx.doom(['n0'])).gone
  assertEquals(gone.length, n)
  assertEquals(gone.at(-1)?.eid, `n${n - 1}`)
})

Deno.test('a wide vocabulary is asked in rounds until nothing is new', () => {
  // Every rung crosses from one statement's tables to the other's, so one
  // round of asking finds one rung and no more. The whole chain still falls.
  let out = both(
    [
      { entity: { eid: 'k' }, n1: {} },
      { entity: { eid: 'a' }, n5: { of: 'k' } },
      { entity: { eid: 'b' }, n1: { of: 'a' } },
      { entity: { eid: 'c' }, n6: { of: 'b' } },
      { entity: { eid: 'd' }, n2: { of: 'c' } },
      // A survivor holding the last casualty: the soft references are read after
      // the closure settles, so an owner of the DEEPEST one still lets go.
      { entity: { eid: 'm' }, mark: { at: 'd' } },
      { entity: { eid: 'z' }, n1: {} },
    ],
    [{ entity: { eid: 'k' }, $delete: true }],
    wide,
  )
  assertEquals(dead(out), ['k', 'a', 'b', 'c', 'd'])
  assertEquals(out.find((b) => b.mark !== undefined), {
    entity: { eid: 'm' },
    mark: null,
  })
})

Deno.test('a wide vocabulary asks no statement more than it may carry', () => {
  // Workerd caps a compound SELECT at five terms and answers a wider one with
  // `too many terms in compound SELECT` — which is not a limit an embedded
  // SQLite (500) will ever show, so the shape is what a fast test can hold.
  let terms = (sql: string) => sql.split(/\bunion\b/i).length
  for (let v of [words, wide]) {
    for (let s of [...doomSql(v, ['x']), ...looseSql(v, ['x'])]) {
      assert(
        terms(s.sql) <= ARMS + 1,
        `${terms(s.sql)} terms in a compound SELECT:\n${s.sql}`,
      )
    }
  }
  assert(narrow(words) && !narrow(wide))
})

Deno.test('a grave is not a casualty twice', () => {
  let s = db()
  let g = graph({ storage: s, vocab: words })
  g.apply([
    { entity: { eid: 'a' }, node: { name: 'a' } },
    { entity: { eid: 'b' }, node: { name: 'b', of: 'a' } },
  ], { now: AT })
  g.apply([{ entity: { eid: 'b' }, $delete: true }], { now: AT })
  // b is already in its grave: deleting a finds nothing to take with it.
  assertEquals(s.tx((tx) => tx.doom(['a'])).gone, [{ eid: 'a', depth: 0 }])
})
