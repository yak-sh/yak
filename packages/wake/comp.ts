// The two components this package ships, as one vocabulary document to load
// beside your own.
//
//   wake{at, every, while, target, note, for, brief}
//                                          when to come back, to what, and for
//                                          whom
//   fired{at}                              the last time it fired
//   watch{query, local, seen, changes}     a query whose change it fires on
//   occurrence{wake, at, call, error}      one firing that did work
//
// One entity, one alarm. `at` is the whole schedule for a one-shot — a
// reminder on a calendar entry, a retry in ten minutes. Add `every` and the
// same row recurs: `at` is then the next instant, moved forward each time it
// is consumed, and a wake with no `at` left is one that has finished.
//
// `target` is what the wake is about, which is not always the entity that
// carries it: a wake on a calendar entry usually means that entry, while a wake
// created by a sweep means whatever the sweep found. It is deleted with what it
// points at (`death: cascade`), because a reminder about a deleted thing is not
// a reminder about anything — cancel the entry and the alarm goes with it.
//
// `every` and then `while` are declared last in the document on purpose, so
// that this table is an existing `wake` table plus appended columns — which is
// what an additive migration produces.
//
// `while` makes the recurrence conditional: `{match, every}` in order, the
// first whose query finds anything setting the cadence (./while.ts). A wake
// none of them holds, with no `every` of its own, sleeps until a write makes
// one hold.
//
// `fired` records the last firing, not every one: it is overwritten each time,
// so a recurring wake holds its most recent firing and a one-shot holds its
// only one. What happened at that instant is for the application to record;
// this package records only that it happened, which is what makes a repeated
// run detectable.
//
// The components themselves are declared in `./vocab.json` — plain JSON Schema,
// readable by anything that reads JSON.
//
// `for` is whom a wake was set for, which a host that runs work for people
// reads as the identity it runs as (./run.ts); `brief` is the words for a
// fresh session each firing. `watch` makes a wake fire only when a query's
// rows changed (./watch.ts), and `occurrence` is the record of one firing that
// ran a call (./run.ts). This file re-exports it under the name
// callers import and keeps the explanation of why it is shaped this way.

import type { Eid, Entity } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component holding when to come back. */
export let WAKE = 'wake'

/** The component recording when a wake last fired. */
export let FIRED = 'fired'

/**
 * A wake: a scheduled return to something, at a time or on a cadence.
 */
export type Wake = {
  /** when it is next due, an ISO instant — absent once it has finished */
  at?: string | null
  /** how it recurs: a duration, five cron fields or a `@` shorthand, optionally
   * followed by an IANA zone (`0 9 * * 1-5 America/New_York`)
   * (see {@link https://jsr.io/@yaks/wake/doc/~/next | next}) */
  every?: string | null
  /** how it recurs while something holds: in order, a query over the whole
   * graph and the cadence it asks for while that query finds anything; the
   * first that holds wins, else `every` does, else the wake sleeps
   * (see {@link https://jsr.io/@yaks/wake/doc/~/cadence | cadence}) */
  while?: { match: string; every: string }[] | null
  /** what the wake is about — the entity carrying it, when absent */
  target?: Eid | null
  /** a line for whoever is woken: why the wake was set */
  note?: string | null
  /** the person it was set for, as whom it runs */
  for?: Eid | null
  /** words for a fresh session each firing, given its call's outcome */
  brief?: string | null
}

/** The component holding the query a wake watches. */
export let WATCH = 'watch'

/** A query a wake watches: it fires only when its rows changed. */
export type Watch = {
  /** the query, as graph_query takes it */
  query: string
  /** read over the store the wake is kept in, not all its person reaches */
  local?: boolean | null
  /** each row the last look saw, by eid, with a digest of it */
  seen?: Record<string, string> | null
  /** what changed at the look the wake last fired for, in words */
  changes?: string | null
}

/** The component recording one firing that did work. */
export let OCCURRENCE = 'occurrence'

/** One firing of a wake that did work. */
export type Occurrence = {
  /** the wake that fired */
  wake: Eid
  /** the instant it fired, ISO */
  at: string
  /** the call it made */
  call?: Eid | null
  /** the call's failure, kept while a helper checks it */
  error?: string | null
}

/** What a fired wake records: when it last fired. */
export type Fired = {
  /** the instant it fired, ISO */
  at: string
}

/** A bundle carrying a wake, as {@link due} returns them. */
export type Waking = { entity: Entity } & { wake: Wake; fired?: Fired }

/**
 * The wake vocabulary, to load beside your own:
 * `loadVocab([wakeDoc, ...mine])`. It declares nothing about what is being
 * woken — that is an ordinary entity in your own vocabulary — only when.
 */
export let wakeDoc: VocabDoc = doc
