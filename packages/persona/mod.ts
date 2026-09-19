/**
 * Who is speaking, and what they are for. A `person` is a human the graph knows
 * by name; a `persona` is a voice an agent wears — a doc whose body IS the
 * voice; and a `role` is what an agent wearing one is FOR: the work it is
 * responsible for, and whether it is running. When a role wakes is a
 * `@yaks/wake` wake pointed at it, where it works is a `@yaks/git` worktree,
 * and what it last decided is `@yaks/kernel`'s `decided` — never a second copy
 * of any of them on the role.
 *
 * Components only: a vocabulary document, no machinery.
 */
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The persona vocabulary, as the document `loadVocab` takes. */
export let personaDoc: VocabDoc = doc as VocabDoc
