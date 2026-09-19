/**
 * Being told. A `knock` is a nudge pointed at a thing, with the words that rode
 * along; a `subscription` says whether somebody watches or mutes it; and a `chat`
 * is an open conversation between an actor and a thing.
 *
 * Components only: a vocabulary document, no machinery.
 */
import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The notify vocabulary, as the document `loadVocab` takes. */
export let notifyDoc: VocabDoc = doc as VocabDoc
