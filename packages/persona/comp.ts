// The components this package ships, and the names its own code refers to them
// by.
//
//   person{}          a human being, as this graph knows them
//   persona{home}     instructions an agent runs with — the `doc` body on the
//                     same entity IS the instruction text
//   role{state, …}    a persona assigned to standing work
//
// The declarations themselves are in `./vocab.json` — plain JSON Schema,
// readable by anything that reads JSON. This file re-exports that document
// under the name callers import, and keeps the explanation of why it is shaped
// the way it is.
//
// An agent is not a person, and a role is neither: it is a job a persona is
// assigned to. Keeping the three apart is what makes an author stamp worth
// reading.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component that marks a human being. */
export let PERSON = 'person'

/** The component that marks a persona; the `doc` on the same entity holds
 * the instruction text. */
export let PERSONA = 'persona'

/** The component that marks a standing job. */
export let ROLE = 'role'

/**
 * The persona vocabulary, loaded beside {@link https://jsr.io/@yaks/doc |
 * @yaks/doc}'s and your own: `loadVocab([docDoc, personaDoc, ...mine])`. Every
 * component here is used together with a `doc` — a person has a name, a
 * persona has its instruction text, a role has a description of what it is for
 * — which is why this document is never loaded without that one.
 */
export let personaDoc: VocabDoc = doc as VocabDoc
