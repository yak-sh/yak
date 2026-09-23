// The task components and nothing that runs: the module a server imports as
// `@yaks/task/vocab`. It reaches no storage, no SQL and no runtime, so a
// browser tab that loads this vocabulary loads nothing else.
//
// `derived` is here rather than beside the rules because a computed property is
// part of what a component means — `task.status` is declared but never
// written, and the SQL that computes it from the marks is the other half of
// that declaration.

import type { VocabDoc } from '@yaks/vocab'
import type { Derived } from '@yaks/sql'
import { taskDoc } from './comp.ts'
import { derived as ladder } from './status.ts'
import { MARKS } from './words.ts'

export { taskDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [taskDoc]

/** A task's status, computed from the default ladder of marks rather than
 * stored. A graph that adds a rung — a held lease reading `wip` — declares it
 * in the plugin that owns the rung (@yaks/session), whose own `vocab` module is
 * imported after this one. */
export let derived = (): Derived => ladder(MARKS)
