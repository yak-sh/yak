/**
 * @yaks/alias — a name for an entity, and the id it is worth: the `alias` kind
 * of {@link https://jsr.io/@yaks/key | @yaks/key} for a
 * {@link https://jsr.io/@yaks/graph | @yaks/graph}.
 *
 * A `$alias` lives for one batch. This is the other one — the name that
 * outlives it:
 *
 * ```ts
 * // written twice, a week apart, and there is ONE lemon cake
 * // { entity: { eid: '$r' },
 * //   alias: { name: 'recipe:lemon-cakes' },
 * //   doc: { title: 'Lemon cakes', body: '3 lemons…' } }
 * ```
 *
 * The second write finds the name, resolves `$r` to the entity already wearing
 * it, and patches that — so a seed, a chunked import and a page that saves the
 * same row every time it opens are all idempotent without a lookup table.
 *
 * ## A name is a key
 * `alias` is a KIND TAG on @yaks/key's `key{of, value}` carrier, which is where
 * everything structural lives: the key is its own entity, so one thing has as
 * many names as you write; its id is derived from the kind and the value, so a
 * name is unique by construction and reading one back is a `get`; and `of` dies
 * by cascade, so a deleted thing frees its names. The sugar above is this
 * package's — `alias{name}` on the entity is lifted into the key row at the
 * `normalize` phase.
 *
 * ## A name goes where an eid goes
 * ```ts
 * // { entity: { eid: '$c' }, comment: { target: 'recipe:lemon-cakes' } }
 * ```
 * A reference column takes a name, a bundle's own `entity.eid` takes one, and a
 * door takes one through `graph.address(ids)`. An id that IS an entity always
 * wins; an id shaped like a uuid or a content hash is never looked up at all,
 * so a batch of ordinary references costs nothing.
 *
 * ```ts
 * import { loadVocab } from '@yaks/vocab'
 * import { graph } from '@yaks/graph'
 * import { keyDoc, keyKeywords, keys } from '@yaks/key'
 * import { aliasDoc, aliases } from '@yaks/alias'
 *
 * let vocab = loadVocab([keyDoc, aliasDoc, mine], [keyKeywords])
 * // let g = graph({ storage, vocab, plugins: [keys(vocab), aliases(vocab)] })
 * ```
 *
 * It imports no platform API, so the same package runs on a server, in a
 * worker, and in a browser tab.
 *
 * @module
 */

export * from './comp.ts'
export * from './sugar.ts'
export * from './refs.ts'
export * from './plugin.ts'
