/**
 * What was proposed and what was decided: a `design` is a proposal written down
 * so it can be argued with, a `review` is somebody's verdict on one, and an
 * `architecture` is the description that stands afterwards. The marks that say
 * who proposed and who decided are [@yaks/kernel](../kernel)'s, because
 * anything can be proposed.
 *
 * Components only: a vocabulary document, no machinery.
 */
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The design vocabulary, as the document `loadVocab` takes. */
export let designDoc: VocabDoc = doc as VocabDoc
