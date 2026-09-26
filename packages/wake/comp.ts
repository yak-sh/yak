// The two components this package ships, as one vocabulary document to load
// beside your own.
//
//   wake{at, every, while, target, note}   when to come back, and to what
//   fired{at}                              the last time it fired
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
// first whose query finds anything setting the cadence (./pace.ts). A wake
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
// readable by anything that reads JSON. This file re-exports it under the name
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
   * (see {@link https://jsr.io/@yaks/wake/doc/~/pace | pace}) */
  while?: { match: string; every: string }[] | null
  /** what the wake is about — the entity carrying it, when absent */
  target?: Eid | null
  /** a line for whoever is woken: why the wake was set */
  note?: string | null
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
