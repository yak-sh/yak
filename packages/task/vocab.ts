// The task words, and only the words: the `vocab` facet a host takes
// (`@yaks/task/vocab`). It reaches no storage, no SQL and no runtime, so a
// browser tab loading this vocabulary loads nothing else.
//
// `derived` is here rather than beside the rules because a computed column is
// part of what a word MEANS — `task.status` is declared, never written, and
// the SQL that reads it off the marks is the declaration's other half.

import type { VocabDoc } from '@yaks/vocab'
import type { Derived } from '@yaks/sql'
import { taskDoc } from './comp.ts'
import { derived as ladder } from './status.ts'
import { MARKS } from './words.ts'

export { taskDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [taskDoc]

/** A task's status, read off the default ladder of marks rather than kept. A
 * host that adds a rung — a held lease reading `wip` — says so in the plugin
 * that OWNS the rung (@yaks/session), whose facet composes after this one. */
export let derived = (): Derived => ladder(MARKS)
