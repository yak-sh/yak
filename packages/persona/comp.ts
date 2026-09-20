// The words this package ships, and the names its own code says them by.
//
//   person{}          a human being, as this graph knows them
//   persona{home}     a voice an agent wears — the doc beside it IS the voice
//   role{state, …}    a persona hired into standing work
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers say
// and keeps the prose about why it is shaped the way it is.
//
// An agent is not a person, and a role is neither: it is a job, which a persona
// is hired into. Keeping the three apart is what makes a byline worth reading.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component a human being wears. */
export let PERSON = 'person'

/** The component a voice wears; the `doc` beside it is the voice itself. */
export let PERSONA = 'persona'

/** The component a standing job wears. */
export let ROLE = 'role'

/**
 * The persona vocabulary, to load beside {@link https://jsr.io/@yaks/doc |
 * @yaks/doc}'s and your own: `loadVocab([docDoc, personaDoc, ...mine])`. Every
 * one of these words is a `doc` too — a person has a name, a persona has its
 * voice, a role says what it is for — which is why this document is never
 * loaded without that one.
 */
export let personaDoc: VocabDoc = doc as VocabDoc
