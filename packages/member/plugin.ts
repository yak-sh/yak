// The package as a graph plugin: the three components, and the guard over
// them.
//
// A guard needs to know which app it speaks for, because the answer to "may
// this land?" is about an app and this graph is only bundles. So the plugin is
// built with that app named, the way an application names its own subject —
// and, optionally, the space whose owners own it.
//
// SEEDING. A graph with a guard on it and an empty roster admits nobody: there
// is no owner yet, so there is nobody who may write the row that makes one.
// That is not a bug to route around, it is what a bootstrap is — so write the
// first owner BEFORE the guard exists, and add the guard after:
//
//   let g = graph({ storage, vocab })
//   g.apply([{ entity: { eid: 'm1' }, member: { space, person: dana,
//              role: 'owner' } }])
//   g.use(members({ app, space }))
//
// From there the roster governs itself: an owner adds the next one.

import type { Plugin } from '@yaks/graph'
import { memberDoc } from './comp.ts'
import { type Guard, guarding } from './guard.ts'

/**
 * The membership plugin: the `member`, `grant` and `access` components, and a
 * `precondition` hook that refuses a write the actor's role or grant does not
 * allow.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { memberDoc, members } from '@yaks/member'
 *
 * let vocab = loadVocab([memberDoc, club])
 * let g = graph({ storage, vocab, plugins: [members({ app: list, space: club })] })
 * ```
 *
 * Reads are NOT guarded here — a query never reaches `apply()`. The door asks
 * {@link https://jsr.io/@yaks/member/doc/~/policy | policy}`(storage).canRead`
 * before it answers one.
 *
 * ## The effect slot this package leaves empty
 * Adding someone to a roster usually means writing to them. That is a
 * `created('member')` handler on
 * {@link https://jsr.io/@yaks/effects | @yaks/effects} — post-commit, so the
 * seat is real before the letter goes, and isolated, so a mail server that is
 * down does not refuse the invitation. This package ships no such handler;
 * `@yaks/mail` fills the slot.
 */
export let members = (where: Guard): Plugin => ({
  name: '@yaks/member',
  vocab: [memberDoc],
  hooks: { precondition: guarding(where) },
})
