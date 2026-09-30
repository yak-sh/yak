// The task components and nothing that runs: the module a server imports as
// `@yaks/task/vocab`. It reaches no storage, no SQL and no runtime, so a
// browser tab that loads this vocabulary loads nothing else.
//
// A task's status is declared in the document itself (the `status` keyword on
// `task`), so every store reads it from there; nothing here hands one an
// expression.

import type { VocabDoc } from '@yaks/vocab'
import { taskDoc } from './comp.ts'
import manifest from './deno.json' with { type: 'json' }

export { taskDoc }

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [taskDoc]
