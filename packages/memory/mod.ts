/**
 * @yaks/memory — what a person said, kept in their own words: the `memory`
 * component domain for a {@link https://jsr.io/@yaks/graph | @yaks/graph},
 * with the halves that make it useful — marking what somebody said, having it
 * read back at the start of the next conversation, and reading around it.
 *
 * An agent that summarises what somebody told it can only ever remove
 * information. Everything the summary keeps was already in the sentence, and
 * everything it drops is gone for good — so the next agent, and the one after
 * that, work from a copy of a copy. This package is the other way round: a
 * memory marks the person's sentence where it already is (a session entry, a
 * comment, a doc), and only words the graph holds nowhere get a doc of their
 * own, with the line or two of context somebody needs to read them later.
 *
 * ```ts
 * import { marked, saved } from '@yaks/memory'
 *
 * // [{ entity: { eid: 'entry1' }, memory: { about: 'recipes' } }]
 * marked({ eid: 'entry1', about: 'recipes' })
 * // { entity: { eid: 'm1' },
 * //   doc: { body: 'use grams, never cups' },
 * //   memory: { space: 's1', about: 'recipes' } }
 * saved({ eid: 'm1', said: 'use grams, never cups', space: 's1',
 *         about: 'recipes' })
 * ```
 *
 * The pieces:
 *
 * - {@link memoryDoc} is the component, as JSON Schema — a mark, whose `at`,
 *   `by` and `via` the graph stamps;
 * - {@link marked} is the write that marks words the graph already holds, and
 *   {@link saved} the one that keeps words it holds nowhere: an empty sentence
 *   is rejected, and the context is truncated to {@link LINES} lines so it
 *   stays context and never becomes the summary the sentence was saved instead
 *   of;
 * - {@link words} reads the words from whichever component holds them;
 * - {@link line} builds the read: a query string in the filter grammar every
 *   yaks store answers — with words in it, the store's full-text index selects
 *   them; with none, newest first — and {@link Ranker} is the interface a
 *   server with a vector service implements to rank by meaning instead, with
 *   {@link ordered} putting the store's result into that order;
 * - {@link passage} builds the text an agent is given at the start of a
 *   conversation: the newest few, whole, under one heading, bounded by
 *   {@link LAST} and {@link BYTES}.
 *
 * The tools, including the four that read around a memory, are
 * `@yaks/memory/tools`. It imports no platform API, so the same package runs
 * on a server, in a worker, and in a browser tab.
 *
 * @module
 */

export * from './comp.ts'
export * from './save.ts'
export * from './recall.ts'
export * from './passage.ts'
