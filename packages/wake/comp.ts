// The two components this package ships, as one vocabulary document to load
// beside your own.
//
//   wake{at, every, target, note}   when to come back, and what about
//   fired{at}                       the last time it did
//
// One entity, one alarm. `at` is the whole schedule for a one-shot — a
// reminder on a calendar entry, a retry in ten minutes. Add `every` and the
// same row recurs: `at` is then the NEXT instant, moved forward each time it
// is consumed, and a wake with no `at` left is one that has finished.
//
// `target` is what the wake is ABOUT, which is not always the entity carrying
// it: a wake on a calendar entry usually means itself, and a wake minted by a
// sweep means the thing it found. It dies with what it points at
// (`death: cascade`), because a reminder about a deleted thing is not a
// reminder about anything — cancel the entry and the alarm goes with it.
//
// `fired` records the last firing, not every one: it is overwritten each time,
// so a recurring wake carries its most recent and a one-shot carries its only.
// What HAPPENED at that instant is the host's to record; this package says
// only that it happened, which is what makes a re-run safe to detect.

import type { Eid, Entity } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'

/** The component naming when to come back. */
export let WAKE = 'wake'

/** The component stamping when a wake last went off. */
export let FIRED = 'fired'

/**
 * A wake: the promise to revisit something at a time, or on a cadence.
 */
export type Wake = {
  /** when it is next due, an ISO instant — absent once it has finished */
  at?: string | null
  /** how it recurs, if it does: a duration, a cron line, or a `@` shorthand
   * (see {@link https://jsr.io/@yaks/wake/doc/~/next | next}) */
  every?: string | null
  /** what the wake is about — the carrier itself when it is absent */
  target?: Eid | null
  /** a line for whoever is woken: why you asked to be */
  note?: string | null
}

/** The stamp a consumed wake wears: when it last went off. */
export type Fired = {
  /** the instant it fired, ISO */
  at: string
}

/** A bundle carrying a wake, as {@link due} answers with. */
export type Waking = { entity: Entity } & { wake: Wake; fired?: Fired }

/**
 * The wake vocabulary, to load beside your own:
 * `loadVocab([wakeDoc, ...mine])`. It declares nothing about what is being
 * woken — that is an ordinary entity in your own vocabulary — only when.
 */
export let wakeDoc: VocabDoc = {
  title: 'wake',
  $defs: {
    wake: {
      type: 'object',
      kind: true,
      prefix: 'W',
      description: 'a promise to come back to something at a time',
      properties: {
        at: {
          type: 'string',
          format: 'date-time',
          description:
            'when it is next due; absent once a one-shot has fired and a recurrence has ended',
        },
        target: {
          type: 'string',
          ref: 'entity',
          death: 'cascade',
          description:
            'what the wake is about — the entity carrying it when absent',
        },
        note: {
          type: 'string',
          description: 'a line for whoever is woken: why you asked to be',
        },
        // Declared last so this table is a graph's existing `wake` table plus
        // one appended column — which is what an additive migration does.
        every: {
          type: 'string',
          description:
            'how it recurs: a duration (30m, 2h, 1d), a cron line (0 9 * * 1-5), or @daily',
        },
      },
    },
    fired: {
      type: 'object',
      description: 'when a wake last went off',
      properties: {
        at: {
          type: 'string',
          format: 'date-time',
          description: 'the instant it fired',
        },
      },
    },
  },
}
