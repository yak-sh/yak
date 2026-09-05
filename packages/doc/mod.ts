/**
 * @yaks/doc — the words a person reads: the `doc{title, body}` component
 * domain for a {@link https://jsr.io/@yaks/graph | @yaks/graph}.
 *
 * Say a book club keeps its reading list, its potluck sign-up and the minutes
 * of last Tuesday in one graph. Three different things — and every one of them
 * has a name and some prose. This package is that shared half:
 *
 * ```ts
 * // { entity: { eid: 'm1' },
 * //   doc: { title: 'Minutes, 3 March', body: 'Ana chaired…' },
 * //   minutes: { chaired_by: ana } }
 * ```
 *
 * `doc` is a FACET, not a record. Adding it to something makes it readable
 * without making it stop being what it was, and one search index, one editor
 * and one card renderer are written against `doc` rather than against twenty
 * tables that each grew a `title` column.
 *
 * ## Two columns
 * `title` is the one line the entity is known by. `body` is the prose, as
 * markdown. Nothing else: a slug is addressing, an excerpt is derived, a format
 * is a rendering decision, and the clock belongs to the graph — each is its own
 * component on the same entity.
 *
 * ## The body may be content-addressed, and `doc` is not told
 * `body` declares `store: "blob"`, a keyword this package NAMES and does not
 * import. Load the vocabulary without
 * {@link https://jsr.io/@yaks/blob | @yaks/blob}'s `blobKeywords` and `body` is
 * an ordinary text column; load it with them and compose `blobs()`, and the
 * text is swapped for its address on the way into the row and back on the way
 * out. The same document, the same writes, the same reads — so a graph can grow
 * into content-addressed storage without a migration of its vocabulary.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { docDoc, docs } from '@yaks/doc'
 *
 * let vocab = loadVocab([docDoc, mine])
 * // let g = graph({ storage, vocab, plugins: [docs()] })
 * ```
 *
 * ## Who else wants it
 * {@link https://jsr.io/@yaks/mail | @yaks/mail} keeps a letter's subject in
 * `doc.title` and the letter itself in `doc.body`, so a letter reads back
 * through the same renderer as everything else. Packages that need `doc` depend
 * on this one and leave the composing to you — a vocabulary refuses a component
 * declared twice, so the word has exactly one home.
 *
 * ## Kind order
 * `doc` is a kind, and it deliberately declares no `before`: a `before` may only
 * name a kind the loaded vocabulary declares, so a base package cannot order
 * itself against words it does not ship. Your own document says which wins —
 * `before: ['doc']` on the component that is the more specific thing an entity
 * IS.
 *
 * It imports no platform API, so the same document loads on a server, in a
 * worker, and in a browser tab.
 *
 * @module
 */

export * from './comp.ts'
export * from './plugin.ts'
