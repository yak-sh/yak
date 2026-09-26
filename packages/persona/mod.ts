/**
 * Who is acting, what they are responsible for, and the instructions they run
 * with. A `person` is a human being the graph knows by name; a `persona` is a
 * set of instructions an agent runs with, held in the `doc` body on the same
 * entity; and a `role` is what an agent running one is responsible for, plus
 * whether it is currently running. When a role next runs is a `@yaks/wake`
 * wake pointing at it, where it works is a `@yaks/git` worktree, and what it
 * last decided is `@yaks/kernel`'s `decided` — the role keeps no second copy
 * of any of them.
 *
 * Besides those components, this package renders one document. A persona has
 * edges to the documents it includes in full (`contains`) and the documents it
 * only mentions by id (`reads`); {@link wear} reads them out of a storage and
 * {@link voice} renders the set as markdown — the text an agent is given at
 * the top of its context.
 *
 * ```ts ignore
 * import { voice, wear } from '@yaks/persona'
 *
 * let worn = await wear(storage, vocab)('N-1')
 * if (worn) console.log(voice(vocab)(worn))
 * ```
 *
 * It returns text. Where that text goes — a file, a repo, the system prompt
 * of a spawned agent — is the caller's decision. One caller ships beside it
 * and stays out of this entry point, because it writes files: each project's
 * personas in its checkout, `persona_sync` in `./tools` and kept current by
 * `./effects`.
 *
 * @module
 */

export { PERSON, PERSONA, personaDoc, ROLE } from './comp.ts'
export { NAMED, voice, type Worn } from './voice.ts'
export { CARRIES, READS, wear } from './worn.ts'
