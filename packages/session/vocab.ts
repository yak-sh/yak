// The transcript's component declarations, and only those: the module exported
// as `@yaks/session/vocab`. It imports no storage, no SQL and no runtime, so a
// browser tab that loads this vocabulary loads nothing else.
//
// A transcript's status is read off its newest entry, as SQL here
// (./status.ts). A task's status is its ladder in @yaks/task's vocabulary, and
// a graph that leases its tasks has a state @yaks/task cannot know about: a
// held claim reads `wip`. That rung belongs to whoever owns `claim`, which is
// this package, so ./vocab.json adds it to the ladder with an `extends` entry
// on `task`, and every store reads it from there.

import type { Vocab, VocabDoc } from '@yaks/vocab'
import type { Derived } from '@yaks/sql'
import { sessionDoc } from './comp.ts'
import { sessionDerived } from './status.ts'
import manifest from './deno.json' with { type: 'json' }

export { sessionDoc }

/** What this package is: its manifest's description, the one place it is
 * written, which a host stamps on each document here. */
export let description: string = manifest.description

/** Every document this plugin declares. */
export let docs: VocabDoc[] = [sessionDoc]

/** A transcript's status and cost. */
export let derived = (vocab: Vocab): Derived => sessionDerived(vocab)
