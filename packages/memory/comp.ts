// The one component this package declares: `memory`, a thing a person said.
//
// A memory is NOT a note an agent took. It is the person's own sentence, kept
// as they said it, because a paraphrase is strictly less than what was said —
// an agent that summarises can only ever remove information, and the next
// agent cannot get it back. So the shape is built to make the verbatim thing
// the easy thing:
//
//   { entity: { eid: m },
//     doc: { body: 'use grams, never cups' },
//     memory: { space: s, about: 'recipes', context: 'about the recipe app' } }
//
// The WORDS are `doc.body`. That is not indirection for its own sake: `doc` is
// what a store indexes for search, so the person's sentence is findable the
// same way every other text is, and a memory renders through the same renderer
// as everything else. `memory` holds the rest — whose space, which app, and the
// line or two of context somebody needs to make sense of the sentence six weeks
// later.
//
// The BYLINE is the graph's own `created{at, by}`. Who said it and when are
// facts every entity already carries, and a second copy of them here would
// drift from the first.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// import and keeps the prose about why it is shaped the way it is.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component naming a thing a person said. */
export let MEMORY = 'memory'

/**
 * The memory vocabulary document, to load beside @yaks/doc's and your own:
 * `loadVocab([docDoc, memoryDoc, ...mine])`. It declares nothing about what a
 * space IS — that component is your own document's — only that a memory
 * belongs to one.
 */
export let memoryDoc: VocabDoc = doc
