/**
 * A page as WITNESSED, not as it is now: `web{url, frozen_at}` says which
 * address was read and when a copy of its bytes was taken, so a citation keeps
 * meaning after the page changes or goes away. The bytes themselves are an
 * [@yaks/blob](../blob) artifact.
 *
 * Components only: a vocabulary document, no machinery.
 */
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The page vocabulary, as the document `loadVocab` takes. */
export let pageDoc: VocabDoc = doc as VocabDoc
