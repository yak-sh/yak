// The package as a @yaks/graph plugin: the three components, and the write
// guard over them.
//
// The guard has to be told which app it decides for, because "may this be
// written?" is a question about an app and the graph itself holds only rows. So
// the plugin is built with that app named, the way an application names its own
// subject — and, optionally, the space whose owners own it.
//
// Seeding. A graph with the guard installed and an empty roster admits nobody:
// there is no owner yet, so there is nobody allowed to write the row that makes
// one. That is not a bug to route around, it is what a bootstrap is — so write
// the first owner before installing the guard, and install it after:
//
//   let g = graph({ storage, vocab })
//   g.apply([{ entity: { eid: 'm1' }, member: { space, person: dana,
//              role: 'owner' } }])
//   g.use(members({ app, space }))
//
// From there the roster maintains itself: an owner adds the next one.

import type { Plugin } from '@yaks/graph'
import { memberDoc } from './comp.ts'
import { type Guard, guarding, wanting } from './guard.ts'

/**
 * The membership plugin: the `member`, `grant` and `access` components, and a
 * `precondition` hook that refuses a write the principal's role or grant does
 * not allow.
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
 * Reads are not checked here — a query never reaches `apply()`. The HTTP layer
 * calls
 * {@link https://jsr.io/@yaks/member/doc/~/policy | policy}`(storage).canRead`
 * before it answers one.
 *
 * ## The effect hook this package leaves unregistered
 * Adding someone to a roster usually means messaging them. That is a
 * `created('member')` handler on
 * {@link https://jsr.io/@yaks/effects | @yaks/effects} — it runs after the
 * commit, so the row exists before the message goes out, and it is isolated, so
 * a mail server that is down does not refuse the write. This package ships no
 * such handler; `@yaks/mail` provides one.
 */
export let members = (where: Guard): Plugin => ({
  name: '@yaks/member',
  vocab: [memberDoc],
  hooks: { precondition: guarding(where) },
  wants: wanting(where),
})
