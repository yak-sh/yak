// A task: the work itself, the marks that give it a status nobody writes, and
// the two relations one task says about another.
import type { Plugin } from '@yaks/graph'
import { taskDoc, tasks } from '@yaks/task'
import { taskMarks } from '@yaks/session'
import { derived as statusColumn } from '@yaks/task'
import type { Derived } from '@yaks/sql'

export let vocab = taskDoc
/** A held claim reads as `wip`, which is why the marks come from @yaks/session. */
export let derived = (): Derived => statusColumn(taskMarks)
export let rules = (): Plugin[] => [tasks()]
