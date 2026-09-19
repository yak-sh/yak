// What one committed batch says to the server. A client graph holds three
// kinds of state at once — what the server owns, what this browser owns, and
// what only this render owns — and mixing them in one `apply()` is the whole
// point of running the graph in a page. Which kind a component is, it says
// itself, in the two core vocabulary keywords (@yaks/vocab lifetime.ts):
//
//   sync: "server"  (the default) the server owns it and fans it out
//   sync: "peers"   the server relays it to subscribers without owning it
//   sync: "none"    it stays on this node
//
//   durable: "forever"     (the default) storage — the server's, or the vault
//   durable: "connection"  memory, for as long as this connection lives
//   durable: "5s"          the same, plus a timer
//
// A component with no declaration syncs to the server and is kept forever,
// because the common case is data the server owns.
//
// What a batch says OUTWARD is narrower than what it said locally: only
// components that leave this node, only the columns a client may write (a
// stamp is the server's to make), and only the bundles the caller actually
// sent — a cascade's casualties and the stamp phase's provenance are the local
// graph reporting on itself, and the server will reach the same conclusions
// from the same patch.

import type { Bundle, Comp } from '@yaks/graph'
import { comps, dead } from '@yaks/graph'
import { durableOf, type Sync, syncOf, type Vocab } from '@yaks/vocab'
import { asked, before } from './mark.ts'

export { durableOf, type Sync, syncOf }

/** Whether a component's writes leave this node at all — a `sync: none`
 * component is the local graph talking to itself. */
export let outbound = (vocab: Vocab, comp: string): boolean =>
  syncOf(vocab, comp) != 'none'

/**
 * Where a component's state lives on THIS node, for the components nobody else
 * will ever send back: the VAULT when it is durable forever (it survives a
 * reload), process MEMORY otherwise (it goes with the tab, or with its timer).
 * A component that syncs is neither — the server is what sends it back.
 */
export let local = (vocab: Vocab, comp: string): 'vault' | 'memory' | null =>
  outbound(vocab, comp)
    ? null
    : durableOf(vocab, comp) == 'forever'
    ? 'vault'
    : 'memory'

// The columns of one patch a client may write. A stamped column is the
// server's own (it will write its own `created`), and a computed one has no
// value to send — `writable` is exactly the two of them excluded.
let writable = (vocab: Vocab, name: string, patch: Comp): Comp => {
  let allowed = new Set(vocab.comp(name)?.writable ?? [])
  return Object.fromEntries(
    Object.entries(patch).filter(([c]) => allowed.has(c)),
  )
}

// One committed batch, reduced to the components that sync one way: the
// bundles the caller asked for, carrying the columns a client may write. A
// bundle left with nothing to say drops out.
let leaving = (
  bundles: Bundle[],
  vocab: Vocab,
  sync: Sync,
  marks: boolean,
): Bundle[] =>
  bundles.flatMap((b) => {
    if (!asked(b)) return []
    let out: Bundle = { entity: { eid: b.entity.eid } }
    if (marks && b.$was) out.$was = b.$was
    if (marks && dead(b)) out.$delete = true
    for (let [name, patch] of comps(b)) {
      if (syncOf(vocab, name) != sync) continue
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
 * One committed batch, reduced to what the SERVER should be told — the
 * `sync: server` components, the ones it owns and stores. A batch that is
 * entirely local returns empty and nothing is posted at all.
 *
 * A `$was` precondition rides along, so the guard the local graph just
 * enforced is enforced again against the server's copy; the identity is sent as
 * the `eid` alone, because `num` belongs to whoever is storing it.
 */
export let outward = (bundles: Bundle[], vocab: Vocab): Bundle[] =>
  leaving(bundles, vocab, 'server', true)

/**
 * One committed batch, reduced to what the PEERS should be told — the
 * `sync: peers` components, which the server hands on without keeping.
 *
 * These go up the SOCKET, not through `/apply`. Their lifetime is that
 * socket's: `durable: connection` means the server clears them when it closes,
 * so the connection the value arrived on has to be the one holding it. A
 * second reason is traffic — a caret or a cursor moves faster than a POST
 * should — and a third is that there is nothing to guard: a relay value has no
 * stored `was` to check against, and no death to cascade, so neither mark is
 * sent.
 */
export let relayed = (bundles: Bundle[], vocab: Vocab): Bundle[] =>
  leaving(bundles, vocab, 'peers', false)

/**
 * The inverse of one committed batch: what to patch back when the server
 * refuses it. Each bundle is restored from the image {@link before} captured
 * of it — a column it did not hold is cleared, a component it did not wear is
 * dropped — so the local graph lands where it stood before the optimistic
 * write.
 *
 * A DELETE has no inverse: death is final in this model, which is why a batch
 * that deletes is never applied optimistically — it waits for the server
 * (sync.ts), so there is never a tombstone to lift.
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
