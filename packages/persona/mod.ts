/**
 * Who is speaking, what they are for, and what they say. A `person` is a human
 * the graph knows by name; a `persona` is a voice an agent wears — a doc whose
 * body IS the voice; and a `role` is what an agent wearing one is FOR: the work
 * it is responsible for, and whether it is running. When a role wakes is a
 * `@yaks/wake` wake pointed at it, where it works is a `@yaks/git` worktree,
 * and what it last decided is `@yaks/kernel`'s `decided` — never a second copy
 * of any of them on the role.
 *
 * The ACT beside those words is one document. A persona holds edges to the docs
 * it carries (`contains`) and the docs it only names (`reads`); {@link wear}
 * gathers them out of a storage and {@link voice} renders the set as markdown —
 * the projection an agent reads at the top of its context.
 *
 * ```ts
 * import { voice, wear } from '@yaks/persona'
 *
 * let worn = await wear(storage, vocab)('N-1')
 * if (worn) console.log(voice(vocab)(worn))
 * ```
 *
 * It answers TEXT. Where that text lands — a file, a repo, a spawn's system
 * prompt — is the host's, which is why nothing here writes one, and why the
 * package has no `./effects`: an effect would have to know that landing place
 * to be worth registering.
 *
 * @module
 */

export { PERSON, PERSONA, personaDoc, ROLE } from './comp.ts'
export { NAMED, voice, type Worn } from './voice.ts'
export { CARRIES, READS, wear } from './worn.ts'
