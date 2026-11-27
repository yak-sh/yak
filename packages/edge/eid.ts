// A link's identity, derived from the link itself.
//
// A link entity is content-addressed, the way a blob is named by the hash of
// its bytes. Its content is the three things a link is — from, relation, to —
// so two writers who create the same link land on one entity instead of two,
// and a writer removing a link computes its id without looking it up. Direction
// is part of that content: `a cites b` and `b cites a` are two links.
//
// The relation is hashed by its identity, the UUID its `$id` gives, never its
// label, so renaming a relation moves no link; a relation with no `$id` yet
// hashes its label, as every relation did before identities.
//
// This is the derivation. Every caller computes it here — the browser page that
// creates a link, the server that accepts it, the code that removes it —
// because an id computed two different ways is two different ids.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import { comps } from '@yaks/graph/bundle'
import { derivedEid } from '@yaks/graph/identity'
import type { Derive } from '@yaks/graph'
import { formerKey } from '@yaks/graph/identity'
import {
  identity,
  identityIn,
  type Vocab,
  type VocabDoc,
} from '@yaks/vocab/runtime'

/**
 * A relation as a link names it: its label, the component the link carries,
 * and its identity, what the link's eid hashes. A label alone is a relation
 * with no `$id` yet, whose label is its identity.
 */
export type Relation = string | { label: string; id: string }

/** One relation a vocabulary document declares, for {@link edgeEid},
 * `link` and `unlink`: `relation(kernelDoc, 'cites')`. */
export let relation = (doc: VocabDoc, label: string): Relation => ({
  label,
  id: identity(doc, label),
})

/** One relation as a loaded vocabulary holds it, for a relation named by
 * data: `relationIn(vocab, tag)`. */
export let relationIn = (
  vocab: Pick<Vocab, 'comp'>,
  label: string,
): Relation => ({
  label: vocab.comp(label)?.name ?? label,
  id: identityIn(vocab, label),
})

/**
 * The eid a link derives: `sha256("<from>|<relation>|<to>")` formatted as a
 * UUID (@yaks/graph's `derivedEid` — the one derivation shared by everything
 * content-addressed, so an id computed here and an id computed elsewhere are
 * the same id).
 *
 * `relation` is the component stored beside `edge` ({@link relation}), or
 * its identity (`identityIn` over a loaded vocabulary), or its label while it
 * has no `$id`; never the name a query uses for it.
 */
export let edgeEid = (from: Eid, relation: Relation, to: Eid): Eid =>
  derivedEid(
    `${from}|${typeof relation == 'string' ? relation : relation.id}|${to}`,
  )

/**
 * The name of the relation component in a bundle, or `undefined` when it has
 * none. `tags` is the vocabulary's component → relation-name map
 * ({@link names}); only a declared relation counts, so an ordinary component
 * stored beside the edge is not mistaken for one.
 */
export let tagOf = (
  bundle: Bundle,
  tags: Record<string, string>,
): string | undefined =>
  comps(bundle).find(([name, comp]) => comp && tags[name])?.[0]

/**
 * How the `edge` component derives its own entity id — the {@link Derive} the
 * graph calls when an edge bundle arrives under a `$alias`, so that the write
 * creating a link also learns the id it landed on. The relation is hashed by
 * the identity `vocab` gives it.
 *
 * An incomplete link derives nothing (it returns `''`) and the entity is given
 * an ordinary generated id, at which point the {@link stated} hook rejects the
 * write and names the missing part — a far better error than a link quietly
 * identified by half of itself.
 */
export let derive = (
  tags: Record<string, string>,
  vocab?: Pick<Vocab, 'comp'>,
): Derive => {
  let by =
    (key: (tag: string) => string | undefined): Derive =>
    ({ from, to }: Comp, bundle: Bundle) => {
      let tag = tagOf(bundle, tags)
      let id = tag && key(tag)
      return id && from != null && to != null
        ? edgeEid(String(from), id, String(to))
        : ''
    }
  return vocab
    ? Object.assign(by((tag) => identityIn(vocab, tag)), {
      former: by((tag) => formerKey(vocab, tag)),
    })
    : by((tag) => tag)
}
