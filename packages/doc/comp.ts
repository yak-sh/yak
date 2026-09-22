// The one component this package ships, as a vocabulary document to load
// beside your own.
//
//   doc{title, body}   the text a person reads
//
// The component itself is declared in `./vocab.json` — plain JSON Schema,
// readable by anything that reads JSON. This file re-exports it under the name
// callers import and keeps the explanation of why it is shaped this way.
//
// It describes one aspect of an entity, not the whole entity. A task, a letter,
// a recipe and a comment are all different things, and every one of them has
// something a person reads — so the title and the body live in one component
// any kind can carry, instead of a `title` column repeated down twenty tables.
// That is what makes one search index, one editor and one card renderer
// possible: they are written against `doc`, and they work on anything that
// carries it.
//
// Two columns, and why not A third. A `slug`, an `excerpt`, a `format`, an
// `updated_at` all look like they belong here and none of them do: a slug is
// addressing, an excerpt is derived, a format is a rendering decision, and the
// clock is the graph's. Each is its own component on the same entity, which is
// the whole point of components.
//
// `body` Declares `store: "blob"`, which is @yaks/blob's keyword — this package
// does not import that package (Jeff, 2026-09-05: "yak-doc does *not* depend on
// yak-blob. it is `{title: string, body: text}`"). A keyword is carried by the
// loader and interpreted by whoever registered it, so the declaration does
// nothing until somebody composes @yaks/blob in: load without `blobKeywords`
// and `body` is an ordinary text column; load with them and the text is
// swapped for its content address on the way into the row and back on the way
// out, without `doc` or the application being involved. The `$vocabulary` URI
// is written out in the file for the same reason — it names the keyword's
// namespace without depending on the package that interprets it.
//
// No `before`. The fleet's own `doc` sorts before its `alias` kind, and a
// `before` may only name a kind the loaded vocabulary declares — so a package
// that ordered itself against a kind it does not ship could not load on its
// own. Which of `doc` and your own kind wins is for your vocabulary to decide:
// declare `before: ['doc']` on the component that is the more specific thing an
// entity IS, the way @yaks/task's `task` and a yaks.app manifest both do.

import type { VocabDoc } from '@yaks/vocab'
import doc from './vocab.json' with { type: 'json' }

/** The component carrying the text a person reads. */
export let DOC = 'doc'

/** The column carrying the one-line name. */
export let TITLE = 'title'

/** The column carrying the prose. */
export let BODY = 'body'

/**
 * The document vocabulary, to load beside your own:
 * `loadVocab([docDoc, ...mine])`. It declares nothing about what a task or a
 * letter is — those are plain entities in your own vocabulary — only the title
 * and the body they read back as.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { docDoc } from '@yaks/doc'
 *
 * let vocab = loadVocab([docDoc, mine])
 * // { entity: { eid: 'r1' }, doc: { title: 'Lemon cake', body: '3 lemons…' } }
 * ```
 *
 * Register {@link https://jsr.io/@yaks/blob | @yaks/blob}'s `blobKeywords` when
 * you load and `body` becomes content-addressed; register nothing and it is a
 * text column. The document is the same either way.
 */
export let docDoc: VocabDoc = doc
