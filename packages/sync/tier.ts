// Which components leave the process. A client graph holds three kinds of
// state at once — what the server owns, what this browser owns, and what only
// this render owns — and mixing them in one `apply()` is the whole point of
// running the graph in a page. So the tier is declared ONCE, on the component,
// as a vocabulary keyword:
//
//   persist: "wire"    (the default) synced to the server
//   persist: "local"   kept by this client, never sent
//   persist: "none"    ephemeral — held while the process lives
//
// A component with no declaration syncs, because the common case is data the
// server owns, and a vocabulary shared with a server would otherwise have to
// repeat the word on every component.
//
// This module also decides what one committed batch says to the server, which
// is narrower than what it said locally: only wire-tier components, only the
// columns a client may write (a stamp is the server's to make), and only the
// bundles the caller actually sent — a cascade's casualties and the stamp
// phase's provenance are the local graph reporting on itself, and the server
// will reach the same conclusions from the same patch.

import type { Bundle, Comp } from '@yaks/graph'
import { comps, dead } from '@yaks/graph'
import type { Keywords, Vocab } from '@yaks/vocab'
import doc from './meta/sync.vocab.json' with { type: 'json' }
import { asked, before } from './mark.ts'

/** The URI a vocab file declares under `$vocabulary` to use `persist`. */
export let SYNC_URI = 'https://yaks.sh/vocab/sync'

/**
 * The `persist` keyword vocabulary, ready to register:
 * `loadVocab(docs, [syncKeywords])` carries each component's declared tier onto
 * `v.comp(name).keywords.persist`, which is where {@link tierOf} reads it.
 */
export let syncKeywords: Keywords = { uri: SYNC_URI, comp: ['persist'], doc }

/** Where a component's data lives: on the server, in this client, or nowhere
 * past this process. */
export type Tier = 'wire' | 'local' | 'none'

/**
 * The tier a component is declared at — `wire` when it says nothing, so a
 * vocabulary written for a server needs no sync keyword at all to sync.
 */
export let tierOf = (vocab: Vocab, comp: string): Tier => {
  let said = String(vocab.comp(comp)?.keywords.persist)
  return said == 'local' || said == 'none' ? said : 'wire'
}

// The columns of one patch a client may write. A stamped column is the
// server's own (it will write its own `created`), and a computed one has no
// value to send — `writable` is exactly the two of them excluded.
let writable = (vocab: Vocab, name: string, patch: Comp): Comp => {
  let allowed = new Set(vocab.comp(name)?.writable ?? [])
  return Object.fromEntries(
    Object.entries(patch).filter(([c]) => allowed.has(c)),
  )
}

/**
 * One committed batch, reduced to what the server should be told: the bundles
 * the caller asked for, carrying their wire-tier components and the columns a
 * client may write. A bundle left with nothing to say drops out, and a batch
 * that is entirely local returns empty — nothing is posted at all.
 *
 * A `$was` precondition rides along, so the guard the local graph just
 * enforced is enforced again against the server's copy; the identity is sent as
 * the `eid` alone, because `num` belongs to whoever is storing it.
 */
export let outward = (bundles: Bundle[], vocab: Vocab): Bundle[] =>
  bundles.flatMap((b) => {
    if (!asked(b)) return []
    let out: Bundle = { entity: { eid: b.entity.eid } }
    if (b.$was) out.$was = b.$was
    if (dead(b)) out.$delete = true
    for (let [name, patch] of comps(b)) {
      if (tierOf(vocab, name) != 'wire') continue
      if (patch == null) {
        out[name] = null // dropping a component needs no columns
        continue
      }
      let keep = writable(vocab, name, patch)
      // A patch of nothing but stamps is the graph talking to itself.
      if (Object.keys(patch).length && !Object.keys(keep).length) continue
      out[name] = keep
    }
    return comps(out).length || out.$delete ? [out] : []
  })

/**
 * The inverse of one committed batch: what to patch back when the server
 * refuses it. Each bundle is restored from the image {@link before} captured
 * of it — a column it did not hold is cleared, a component it did not wear is
 * dropped — so the local graph lands where it stood before the optimistic
 * write.
 *
 * A DELETE has no inverse: death is final in this model, so a refused delete
 * leaves a tombstone the local graph cannot lift (see the README).
 */
export let inverse = (bundles: Bundle[]): Bundle[] =>
  bundles.flatMap((b) => {
    let was = before(b)
    if (was === undefined || dead(b)) return []
    let out: Bundle = { entity: { eid: b.entity.eid } }
    for (let [name, patch] of comps(b)) {
      let held = was?.[name] as Comp | undefined
      // Never worn before this batch: the whole component goes back out.
      if (!held) out[name] = null
      // Dropped by this batch: put back what it dropped, whole.
      else if (patch == null) out[name] = held
      // Patched by this batch: every column it named, as it was (or cleared).
      else {
        out[name] = Object.fromEntries(
          Object.keys(patch).map((c) => [c, held[c] ?? null]),
        )
      }
    }
    return comps(out).length ? [out] : []
  })
