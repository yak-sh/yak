/**
 * Who is speaking, and what they are for. A `person` is a human the graph knows
 * by name; a `persona` is a voice an agent wears — a doc whose body IS the
 * voice; and a `role` is what an agent wearing one is FOR: the work it watches,
 * when it wakes, how long it waits. Two roles are a check — a `verifier` looks
 * and a `fixer` repairs — and what they found is a `finding` or a `bug`,
 * counted rather than repeated.
 *
 * Components only: a vocabulary document, no machinery.
 */
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The persona vocabulary, as the document `loadVocab` takes. */
export let personaDoc: VocabDoc = doc as VocabDoc
