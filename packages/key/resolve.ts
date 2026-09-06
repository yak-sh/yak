// Writing a value that is already somebody's, and reading a value back.
//
// The key's id is the pair (./eid.ts), so a value that has been claimed is a
// row sitting at an id anyone can compute. Two things follow, and they are this
// file.
//
// THE DEDUPE. A batch that mints an entity under a `$alias` and states a value
// for it — which is what a seed, a chunked import and a page that saves the
// same row every time it opens all do — should land on the entity that already
// holds the value rather than beside it. So after @yaks/graph has named every
// `$alias`, the derived rows are READ (one `get` by id for the whole batch; no
// query), and where a value is already held the minted id gives way to the
// holder's, in the bundle and in everything pointing at it (`substitute`). The
// rest of the batch then patches the entity that was already there.
//
// THE REFUSAL. A key whose `of` was NOT minted in this batch — a caller who
// wrote an id down — is refused instead, naming the holder. The caller said
// both which entity and which value and they disagree; swapping the id under
// them would be a lie, and the holder's id is the one they wanted.
//
// The read is taken in `mint`, which runs OUTSIDE the transaction. That is a
// window: two isolates claiming one free value at the same instant both find
// nothing and both write. The derived id closes it — both writes address the
// same row, so the second is a patch of the first rather than a second row, and
// the `of` that lands is the one that committed last.

import type { Eid, Hook, Tx } from '@yaks/graph'
import { Refused, substitute, then } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { ofOf, valueOf } from './comp.ts'
import { keyEid, tagOf } from './eid.ts'
import { KEY, names } from './kinds.ts'

/**
 * Who holds each of these values in a kind — one `get` for the whole list, and
 * a value nobody holds is simply absent from the answer. The lookup every door
 * makes: no query, no index, no scan.
 */
export let held = (
  tx: Tx,
  kind: string,
  values: string[],
): Map<string, Eid> | Promise<Map<string, Eid>> => {
  let ask = [...new Set(values)].filter(Boolean)
  if (!ask.length) return new Map()
  return then(tx.get(ask.map((v) => keyEid(kind, v))), (rows) => {
    let by = new Map(rows.map((b) => [b.entity.eid, b]))
    let out = new Map<string, Eid>()
    for (let v of ask) {
      let of = ofOf(by.get(keyEid(kind, v)))
      if (of) out.set(v, of)
    }
    return out
  })
}

/**
 * The `cascade` hook that finishes a release: when what a key named dies, the
 * `key` row goes by the vocabulary's own word (`death: release`) and this drops
 * the kind tag beside it, so nothing is left wearing half a key.
 *
 * It is a RELEASE and not a cascade on purpose. A cascade would tombstone the
 * key entity, and that id is derived from the value — so the value could never
 * be claimed again, by anyone, for the life of the store. Deleting a recipe
 * must free its name.
 */
export let retired = (vocab: Vocab): Hook => {
  let tags = names(vocab)
  return (bundles, tx) => {
    let gone = bundles.filter((b) => b[KEY] === null).map((b) => b.entity.eid)
    if (!gone.length) return bundles
    return then(tx.get(gone), (rows) => {
      let out = rows.flatMap((r) => {
        let tag = tagOf(r, tags)
        return tag ? [{ entity: r.entity, [tag]: null }] : []
      })
      return out.length
        ? then(tx.patch(out), () => [...bundles, ...out])
        : bundles
    })
  }
}

/**
 * The `mint` hook that makes a value permanent: a key somebody already holds
 * resolves this batch's entity onto theirs, and a clash is refused with the
 * holder named. Registered by {@link keys}; exported on its own for a graph
 * that wants the behaviour without the vocabulary.
 */
export let settled = (vocab: Vocab): Hook => {
  let tags = names(vocab)
  return (bundles, tx) => {
    let claims = bundles.flatMap((b) => {
      let value = valueOf(b)
      let tag = tagOf(b, tags)
      return value && tag && ofOf(b) ? [[b, tag, value] as const] : []
    })
    if (!claims.length) return bundles
    // A key is named by its pair. A bundle filed anywhere else would be a
    // second row for one value, which is the one thing this component may not
    // be.
    for (let [b, tag, value] of claims) {
      let at = keyEid(tag, value)
      if (b.entity.eid != at) {
        throw new Refused(
          `a key is named by its kind and value — write ${tag} ${value} at ` +
            `${at}, or under a $alias and let the graph name it`,
        )
      }
    }
    // Which entities this batch minted under a `$alias`: the ones whose id is
    // the graph's to pick, and so the ones an existing holder may replace.
    let ours = new Set(
      bundles.flatMap((b) => b.$alias == null ? [] : [b.entity.eid]),
    )
    return then(tx.get(claims.map(([b]) => b.entity.eid)), (rows) => {
      let was = new Map(rows.map((b) => [b.entity.eid, b]))
      let at = new Map<Eid, Eid>()
      for (let [b, tag, value] of claims) {
        let holder = ofOf(was.get(b.entity.eid))
        let of = ofOf(b)!
        if (!holder || holder == of) continue
        if (!ours.has(of)) {
          throw new Refused(
            `${tag} ${value} is ${holder}'s — say it of that entity, or give ` +
              'this one another value',
          )
        }
        at.set(of, holder)
      }
      return substitute(bundles, vocab, at)
    })
  }
}
