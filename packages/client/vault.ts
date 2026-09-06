// The local tier: the state this browser owns.
//
// A client graph holds three kinds of state at once, and the component says
// which is which (@yaks/sync's `persist` keyword): `wire` belongs to the
// server, `local` belongs to THIS browser, `none` dies with the tab. The wire
// tier is @yaks/sync's business. This file is the local one — the components
// nobody else will ever send back, so if this process does not write them down
// they are gone at the next reload.
//
// A vault is not a `Storage`. Storage answers queries, and a query is answered
// here by the map @yaks/ram already holds; what is missing is durability, so
// the interface is the three things durability needs — load everything at boot,
// write an entity through after a commit, forget one that died. It stays small
// on purpose, and it stays in this package until a second implementation of it
// makes a package worth minting.
//
// Writes are through, not behind: the graph commits first (a local write over a
// local map is synchronous, which is most of the reason to run a graph in a
// page), and the vault hears about it on the `effect` phase afterwards. What is
// written is the entity's WHOLE local state read back from the store, never the
// patch, so a merge is the store's job and not the vault's.

import type { Bundle, Comp, Eid, Graph, Plugin } from '@yaks/graph'
import { comps, dead, detached, then } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { echo, tierOf } from '@yaks/sync'

/** One entity as a vault keeps it: its identity, and the local-tier components
 * it wears. */
export type Saved = {
  /** the entity's id */
  eid: Eid
  /** the number storage gave it, so a reload keeps the ids a page displays */
  num?: number
  /** its local-tier components, by name */
  comps: Record<string, Comp>
}

/** Somewhere to keep the local tier between page loads. {@link idb} is the one
 * that ships; a test hands in {@link stash}, and a host with its own store
 * implements these four members. */
export type Vault = {
  /** everything kept, for the boot that hydrates the graph with it */
  load: () => Promise<Saved[]>
  /** write these entities through, replacing what was kept for each */
  save: (recs: Saved[]) => Promise<void>
  /** forget these entities entirely */
  drop: (eids: Eid[]) => Promise<void>
  /** forget everything — a sign-out, or a schema this build cannot read */
  clear: () => Promise<void>
}

/** The local tier, wired to a graph: the plugin doing the writing, and the
 * promise that resolves once what was kept is back in the graph. */
export type Kept = {
  /** the plugin this registered on the graph */
  plugin: Plugin
  /** resolves when the boot hydration has landed */
  ready: Promise<void>
}

// The mark on the hydration batch, so the write-through hook does not save
// back what it just loaded. Spelled with a `$`, which is what keeps it out of
// admission's column checks and every adapter's write path.
let KEPT = '$kept'

/** A vault in memory: what a test uses in place of {@link idb}, and what a
 * page falls back to when the browser refuses storage. Nothing survives the
 * process, but everything else behaves the same. */
export let stash = (seed: Saved[] = []): Vault => {
  let held = new Map<Eid, Saved>(seed.map((r) => [r.eid, r]))
  return {
    load: () => Promise.resolve([...held.values()]),
    save: (recs) => {
      for (let r of recs) held.set(r.eid, r)
      return Promise.resolve()
    },
    drop: (eids) => {
      for (let eid of eids) held.delete(eid)
      return Promise.resolve()
    },
    clear: () => {
      held.clear()
      return Promise.resolve()
    },
  }
}

/** The local-tier components a bundle wears, by name. */
export let localComps = (
  b: Bundle,
  vocab: Vocab,
): Record<string, Comp> =>
  Object.fromEntries(
    comps(b).flatMap(([name, comp]) =>
      comp && tierOf(vocab, name) == 'local' ? [[name, comp]] : []
    ),
  )

// Whether a committed batch is any of the vault's business: it named a
// local-tier component, or it killed an entity that may have been keeping one.
let concerns = (bundles: Bundle[], vocab: Vocab) =>
  bundles.some((b) =>
    b[KEPT] === undefined &&
    (dead(b) || comps(b).some(([name]) => tierOf(vocab, name) == 'local'))
  )

/**
 * Keep a graph's local tier in a vault. Registers an `effect` hook that writes
 * every touched entity's local components through after the commit, and starts
 * the boot hydration that puts back what the last run kept:
 *
 * ```ts
 * let kept = keep(graph, idb({ name: 'recipes' }))
 * await kept.ready // the drafts are back in the graph
 * ```
 *
 * {@link client} does this for you unless you tell it not to.
 */
export let keep = (graph: Graph, vault: Vault): Kept => {
  let vocab = graph.vocab

  let write = (bundles: Bundle[]) => {
    let touched = [...new Set(bundles.map((b) => b.entity.eid))]
    return then(detached(graph.storage).get(touched), async (now) => {
      let save: Saved[] = []
      let gone: Eid[] = []
      let seen = new Set(now.map((b) => b.entity.eid))
      for (let b of now) {
        let held = dead(b) ? {} : localComps(b, vocab)
        if (Object.keys(held).length) {
          save.push({ eid: b.entity.eid, num: b.entity.num, comps: held })
        } else gone.push(b.entity.eid)
      }
      // An entity the store no longer holds at all is gone from here too.
      for (let eid of touched) if (!seen.has(eid)) gone.push(eid)
      if (save.length) await vault.save(save)
      if (gone.length) await vault.drop(gone)
    })
  }

  let plugin: Plugin = {
    name: '@yaks/client/vault',
    hooks: {
      effect: (bundles) =>
        concerns(bundles, vocab)
          ? then(write(bundles), () => bundles)
          : bundles,
    },
  }
  graph.use(plugin)

  // Hydration is a batch like any other: trusted (these values were admitted
  // once already), marked as an echo so @yaks/sync does not post the local tier
  // at a server, and marked as this package's own so the hook above does not
  // write back what it just read.
  let ready = vault.load().then((recs) => {
    let bundles = recs.map((r): Bundle => ({
      entity: { eid: r.eid, num: r.num },
      ...r.comps,
      [KEPT]: true,
    }))
    if (!bundles.length) return
    return then(graph.apply(echo(bundles), { trusted: true }), () => undefined)
  })

  return { plugin, ready }
}
