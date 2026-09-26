// What one committed list of bundles sends to the server. A client graph holds
// three kinds of state at once — what the server owns, what this browser owns,
// and what only this render owns — and being able to write all three in one
// `apply()` is the whole point of running the graph in a page. Each component
// declares which kind it is, using the two core vocabulary keywords (@yaks/vocab
// lifetime.ts):
//
//   sync: "server"  (the default) the server owns it and fans it out
//   sync: "peers"   the server relays it to subscribers without owning it
//   sync: "none"    it stays on this node
//
//   durable: "forever"     (the default) storage — the server's, or the vault
//   durable: "connection"  memory, for as long as this connection lives
//   durable: "5s"          the same, plus a timer
//
// A component that declares neither is sent to the server and kept forever,
// because the common case is data the server owns.
//
// What is sent outward is narrower than what was written locally: only
// components that leave this node, only the properties a client is allowed to
// write (a stamped property is the server's to write), and only the bundles the
// caller actually passed in — the entities a cascade deleted and the
// provenance the stamping phase wrote are the local graph's own conclusions,
// and the server will reach the same ones from the same patch.

import type { Bundle, Comp } from '@yaks/graph'
import { comps, dead } from '@yaks/graph'
import { durableOf, type Sync, syncOf, type Vocab } from '@yaks/vocab'
import { asked, before } from './mark.ts'

export { durableOf, type Sync, syncOf }

/** Whether a component's writes leave this node at all — a `sync: none`
 * component is never sent anywhere. */
export let outbound = (vocab: Vocab, comp: string): boolean =>
  syncOf(vocab, comp) != 'none'

/**
 * Where a component's state has to be kept on this node, for the components no
 * server will ever send back: the vault when it is durable forever (it
 * survives a reload), process memory otherwise (it goes with the tab, or with
 * its timer). A component that is sent to the server is neither, because the
 * server is what sends it back.
 */
export let local = (vocab: Vocab, comp: string): 'vault' | 'memory' | null =>
  outbound(vocab, comp)
    ? null
    : durableOf(vocab, comp) == 'forever'
    ? 'vault'
    : 'memory'

// The properties of one patch a client is allowed to write. A stamped property
// is the server's to write (it writes its own `created`), and a computed one
// has no value to send — `writable` is exactly those two excluded.
let writable = (vocab: Vocab, name: string, patch: Comp): Comp => {
  let allowed = new Set(vocab.comp(name)?.writable ?? [])
  return Object.fromEntries(
    Object.entries(patch).filter(([c]) => allowed.has(c)),
  )
}

// One committed list of bundles, reduced to the components with one given
// `sync` value: the bundles the caller passed in, carrying the properties a
// client is allowed to write. A bundle with nothing left in it is dropped.
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
        out[name] = null // dropping a component needs no properties
        continue
      }
      let keep = writable(vocab, name, patch)
      // A patch of nothing but stamped properties has nothing to send.
      if (Object.keys(patch).length && !Object.keys(keep).length) continue
      out[name] = keep
    }
    return comps(out).length || out.$delete ? [out] : []
  })

/**
 * One committed list of bundles, reduced to what the server should be told —
 * the `sync: server` components, the ones it owns and stores. A write that is
 * entirely local returns an empty list and nothing is posted at all.
 *
 * The `$was` precondition is sent with it, so the check the local graph just
 * made is made again against the server's copy; the identity is sent as the
 * `eid` alone, because `num` belongs to whoever is storing it.
 */
export let outward = (bundles: Bundle[], vocab: Vocab): Bundle[] =>
  leaving(bundles, vocab, 'server', true)

/**
 * One committed list of bundles, reduced to what the peers should be told —
 * the `sync: peers` components, which the server passes on without storing.
 *
 * These are sent over the WebSocket, not to `POST /apply`. Their lifetime is
 * that socket's: `durable: connection` means the server clears them when the
 * connection closes, so the connection the value arrived on has to be the one
 * holding it. A second reason is traffic — a caret or a cursor moves faster
 * than a POST should — and a third is that there is nothing to check: a
 * relayed value has no stored previous value to compare against, and no
 * deletion to cascade, so neither mark is sent.
 */
export let relayed = (bundles: Bundle[], vocab: Vocab): Bundle[] =>
  leaving(bundles, vocab, 'peers', false)

/**
 * The inverse of one committed list of bundles: what to patch back when the
 * server refuses it. Each bundle is restored from the copy {@link before} took
 * of it — a property it did not hold is cleared, a component it did not have is
 * dropped — so the local graph returns to where it stood before the optimistic
 * write.
 *
 * A DELETE gets no inverse here: a write that deletes is never applied
 * optimistically — it waits for the server (sync.ts), so there is never a
 * tombstone to lift.
 */
export let inverse = (bundles: Bundle[]): Bundle[] =>
  bundles.flatMap((b) => {
    let was = before(b)
    if (was === undefined || dead(b)) return []
    let out: Bundle = { entity: { eid: b.entity.eid } }
    for (let [name, patch] of comps(b)) {
      let held = was?.[name] as Comp | undefined
      // Not present before this write: the whole component is dropped.
      if (!held) out[name] = null
      // Dropped by this write: put back what it dropped, whole.
      else if (patch == null) out[name] = held
      // Patched by this write: every property it named, as it was (or cleared).
      else {
        out[name] = Object.fromEntries(
          Object.keys(patch).map((c) => [c, held[c] ?? null]),
        )
      }
    }
    return comps(out).length ? [out] : []
  })
