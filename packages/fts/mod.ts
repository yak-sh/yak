/**
 * @yaks/fts — full-text search over a yaks graph, on any text property.
 *
 * The fleet's search is not welded to one "document" component. This package
 * indexes whichever component properties a vocabulary marks as text, and
 * answers a search over them — so a title, a body, a comment, or an app's own
 * prose are all searchable through one seam. It is backed by SQLite's FTS5,
 * kept in step with the base rows by triggers, and ranks matches with a
 * highlighted snippet.
 *
 * A search is expressed as a text predicate in the yaks query grammar, so a
 * search box mixes words and filters on one line (see
 * {@link https://jsr.io/@yaks/query | @yaks/query}). This package supplies the
 * text half; a {@link https://jsr.io/@yaks/vocab | @yaks/vocab} schema says
 * which properties are indexed, and a {@link Storage} adapter holds the index.
 *
 * @module
 */

import type { Eid } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'

/** A `comp.prop` pair naming one indexed text property. */
export type Field = { comp: string; prop: string }

/** One search hit: the entity, its rank, and a snippet marking the matches. */
export type Hit = {
  /** the matched entity */
  entity: Eid
  /** the relevance rank (lower is closer), never persisted */
  rank: number
  /** the matched text with hits marked, for display */
  snippet: string
}

/**
 * The search seam: derive the indexed fields from a vocabulary, and answer a
 * text query as ranked hits. The implementation lands with the package; this is
 * the shape it satisfies.
 */
export type Search = {
  /** the text properties this vocabulary marks searchable */
  fields: (vocab: Vocab) => Field[]
  /** the entities matching a text query, ranked, with snippets */
  find: (text: string) => Promise<Hit[]>
}
