// The transcript's component declarations, and only those: the module exported
// as `@yaks/session/vocab`. It imports no storage, no SQL and no runtime, so a
// browser tab that loads this vocabulary loads nothing else.
//
// Two computed columns, not one. A transcript's status is read off its newest
// entry; a task's status is read off its marks, and a graph that leases its
// tasks has a state @yaks/task cannot know about — a held claim reads `wip`.
// That state belongs to whoever owns `claim`, which is this package, so this
// module restates `task.status` with the claim included. An application
// composing both puts @yaks/session after @yaks/task and gets the wider
// reading.

import type { VocabDoc } from '@yaks/vocab'
import type { Derived } from '@yaks/sql'
import { derived as ladder } from '@yaks/task'
import { sessionDoc } from './comp.ts'
import { sessionDerived } from './status.ts'
import { taskMarks } from './children.ts'

export { sessionDoc }

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [sessionDoc]

/** A transcript's status, and a task's read with the lease rung in it. */
export let derived = (): Derived => ({
  ...sessionDerived,
  ...ladder(taskMarks),
})
