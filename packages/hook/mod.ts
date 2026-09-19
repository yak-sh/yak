/**
 * An event another system delivered. The payload is kept as it ARRIVED —
 * body, method, path, headers — beside the verdict on its signature, because a
 * hook nobody signed for is still something that happened and the reader is
 * the one who decides what to trust.
 *
 * Components only: a vocabulary document, no machinery.
 */
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The hook vocabulary, as the document `loadVocab` takes. */
export let hookDoc: VocabDoc = doc as VocabDoc
