/**
 * @yaks/alias — a persistent name for an entity, accepted anywhere its id is:
 * the `alias` kind of key from {@link https://jsr.io/@yaks/key | @yaks/key},
 * for a {@link https://jsr.io/@yaks/graph | @yaks/graph}.
 *
 * A `$alias` lives only for the list of changes it appears in. This is the
 * other kind of name — one that is stored and outlives the write:
 *
 * ```ts
 * // written twice, a week apart, and there is one lemon cake
 * // { entity: { eid: '$r' },
 * //   alias: { name: 'recipe:lemon-cakes' },
 * //   doc: { title: 'Lemon cakes', body: '3 lemons…' } }
 * ```
 *
 * The second write finds the name, resolves `$r` to the entity that already
 * has it, and patches that entity — so a seed script, a chunked import and a
 * page that saves the same row every time it opens are all idempotent without a
 * lookup table.
 *
 * ## A name is a key
 * `alias` is one kind of key: the structure lives in @yaks/key's
 * `key{of, value}` component. The key is its own entity, so one entity has as
 * many names as you write; the key entity's id is derived from its kind and
 * value, so a name is unique by construction and reading one back is a single
 * `get`; and `of` is declared `death: cascade`, so deleting an entity frees its
 * names. The shorthand above is this package's contribution — `alias{name}` on
 * the entity is turned into the key entity during the `normalize` phase.
 *
 * ## A name is accepted wherever an eid is
 * ```ts
 * // { entity: { eid: '$c' }, comment: { target: 'recipe:lemon-cakes' } }
 * ```
 * A reference property accepts a name, a bundle's own `entity.eid` accepts one,
 * and callers resolve one explicitly through `graph.address(ids)`. An id that
 * is an entity always wins; an id shaped like a UUID or a content hash is never
 * looked up at all, so ordinary eid references cost nothing.
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
