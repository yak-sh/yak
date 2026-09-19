/**
 * A purpose that is never finished: a `goal` is not a task and has no status —
 * work SATISFIES it. "Reduce noise, amplify signal" is a goal; the task that
 * cut a page of prose out of the graph satisfies it, and says so with the
 * `satisfies` edge.
 *
 * Components only: a vocabulary document, no machinery.
 */
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The goal vocabulary, as the document `loadVocab` takes. */
export let goalDoc: VocabDoc = doc as VocabDoc
