// The one component this package declares: `memory`, a mark on something a
// person said.
//
// A memory is NOT a note an agent took. It is the person's own sentence, kept
// as they said it, because a paraphrase is strictly less than what was said —
// an agent that summarises can only ever remove information, and the next
// agent cannot get it back. So a memory never holds words of its own: it marks
// the entity where the words already are, whatever that entity is —
//
//   { entity: { eid: e },                       a session entry: what they typed
//     entry: { session: s, seq: 12 },
//     content: { body: 'use grams, never cups' },
//     memory: { context: 'about the recipe app', at, by, via } }
//
// — a comment, a doc, a transcript entry. Only words the graph holds nowhere
// yet (said in a chat on yaks.app, say) get an entity made for them, a doc
// whose body is the sentence. The words are read from whichever holds them
// (./recall.ts `words`), by component, never by kind.
//
// A mark is what the graph calls a component whose `at`, `by` and `via` it
// fills in the first time it is written (@yaks/graph ./stamp.ts), so a memory
// records who marked the words and when; nothing needs approving. Who said
// them, and when, is the entity's own `created{at, by}`. And a mark says what
// happened to an entity, never what the entity is: a comment marked as a
// memory is still a comment (@yaks/vocab `kindOrder`), and only a doc that is
// nothing but a memory is shown as one.
//
// The document itself is `./vocab.json` — plain JSON Schema, readable by
// anything that reads JSON. This file re-exports it under the name callers
// import and keeps the prose about why it is shaped the way it is.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component marking a thing a person said. */
export let MEMORY = 'memory'

/**
 * The memory vocabulary document, to load beside @yaks/doc's and your own:
 * `loadVocab([docDoc, memoryDoc, ...mine])`. It declares nothing about what a
 * space is — that component is your own document's — only that a memory
 * belongs to one.
 */
export let memoryDoc: VocabDoc = doc
