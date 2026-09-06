/**
 * @yaks/memory — what a person SAID, kept in their own words: the `memory`
 * component domain for a {@link https://jsr.io/@yaks/graph | @yaks/graph},
 * with the two halves that make it useful — writing one down, and having it
 * read back at the start of the next conversation.
 *
 * An agent that summarises what somebody told it can only ever remove
 * information. Everything the summary keeps was already in the sentence, and
 * everything it drops is gone for good — so the next agent, and the one after
 * that, work from a copy of a copy. This package is the other way round: the
 * person's sentence is stored as they said it, with only the line or two of
 * context somebody needs to read it later.
 *
 * ```ts
 * import { passage, saved } from '@yaks/memory'
 *
 * // { entity: { eid: 'm1' },
 * //   doc: { body: 'use grams, never cups' },
 * //   memory: { space: 's1', about: 'recipes' } }
 * saved({ eid: 'm1', said: 'use grams, never cups', space: 's1',
 *         about: 'recipes' })
 * ```
 *
 * Four small pieces:
 *
 * - {@link memoryDoc} is the component, as JSON Schema — the words themselves
 *   are the entity's `doc.body`, so a store's own search index finds them;
 * - {@link saved} is the write: an empty sentence is refused, and the context
 *   is clamped to {@link LINES} lines so it stays context and never becomes the
 *   summary the sentence was saved instead of;
 * - {@link line} is the read, as a filter line every yaks store answers — with
 *   words, its full-text index ranks them; with none, newest first — and
 *   {@link Ranker} is the seam a host with a vector service ranks by MEANING
 *   through, ordered back with {@link ordered};
 * - {@link passage} is what an agent is handed at the start of a conversation:
 *   the newest few, whole, under one heading, bounded by {@link LAST} and
 *   {@link BYTES}.
 *
 * It imports no platform API, so the same package runs on a server, in a
 * worker, and in a browser tab.
 *
 * @module
 */

export * from './comp.ts'
export * from './save.ts'
export * from './recall.ts'
export * from './passage.ts'
