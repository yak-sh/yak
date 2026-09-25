// The vault: the state this browser owns and keeps between page loads.
//
// A client graph holds three kinds of state at once, and two keywords in the
// vocabulary decide which is which (@yaks/vocab's `sync` and `durable`): a
// `sync: server` component belongs to the server; a `sync: none` component
// belongs to this browser, and of those the ones that are `durable: forever`
// go in the vault — no server will ever send them back, so if this process
// does not write them down they are gone at the next reload. A `sync: none`
// component that only lasts as long as the `connection` stays in memory and
// never reaches here.
//
// A vault is not a `Storage`. A Storage evaluates queries, and queries here
// are evaluated against the map @yaks/ram already holds; what is missing is
// durability, so the interface is the three things durability needs — load
// everything at start-up, write an entity through after a commit, and forget
// one that was deleted. It stays small on purpose, and it stays in this
// package until a second implementation of it makes a package of its own
// worth publishing.
//
// Writes are write-through, not write-behind: the graph commits first (a
// local write against a local map is synchronous, which is most of the reason
// to run a graph in a page), and the vault is called on the `effect` phase
// afterwards. What is written is the entity's whole set of local components,
// read back from the store rather than taken from the patch, so merging is
// the store's job and not the vault's.

import type { Bundle, Comp, Eid, Graph, Plugin } from '@yaks/graph'
import { comps, dead, detached, then } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { ECHO, local, replicate } from '@yaks/sync'

// The components this file is responsible for: the ones no server sends, and
// which the vocabulary declares outlive the tab.
let vaulted = (vocab: Vocab, comp: string): boolean =>
  local(vocab, comp) == 'vault'

/** One entity as a vault stores it: its identity, and the components that
 * belong to this browser. */
export type Saved = {
  /** the entity's id */
  eid: Eid
  /** the number storage gave it, so a reload keeps the ids a page shows */
  num?: number | null
  /** its browser-owned components, by name */
  comps: Record<string, Comp>
}

/** Somewhere to keep this browser's own components between page loads.
 * {@link idb} is the implementation that ships; a test passes {@link stash},
 * and an application with its own storage implements these four
 * functions. */
export type Vault = {
  /** everything stored, for the start-up that loads it back into the
   * graph */
  load: () => Promise<Saved[]>
  /** write these entities through, replacing what was kept for each */
  save: (recs: Saved[]) => Promise<void>
  /** forget these entities entirely */
  drop: (eids: Eid[]) => Promise<void>
  /** forget everything — a sign-out, or data this build cannot read */
  clear: () => Promise<void>
}

/** This browser's components, connected to a graph: the plugin that does the
 * writing, and the promise that resolves once what was stored is back in the
 * graph. */
export type Kept = {
  /** the plugin this registered on the graph */
  plugin: Plugin
  /** resolves once the stored entities have been loaded back in */
  ready: Promise<void>
}

// The marker on the bundles loaded at start-up, so the write-through hook
// does not save back what it just read. It is named with a leading `$`, which
// is what keeps it out of admission's property checks and out of every
// storage adapter's write path.
let KEPT = '$kept'

/** A vault in memory: what a test uses in place of {@link idb}, and what a
 * page falls back to when the browser refuses storage. Nothing survives the
 * process, but it behaves the same in every other way. */
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

/** The browser-owned components a bundle has, by name. */
export let localComps = (
  b: Bundle,
  vocab: Vocab,
): Record<string, Comp> =>
  Object.fromEntries(
    comps(b).flatMap(([name, comp]) =>
      comp && vaulted(vocab, name) ? [[name, comp]] : []
    ),
  )

// Whether a committed transaction is any of the vault's business: it named a
// browser-owned component, or it deleted an entity that may have had one.
let concerns = (bundles: Bundle[], vocab: Vocab) =>
  bundles.some((b) =>
    b[KEPT] === undefined &&
    (dead(b) || comps(b).some(([name]) => vaulted(vocab, name)))
  )

/**
 * Keep a graph's browser-owned components in a vault. Registers an `effect`
 * hook that writes every changed entity's browser-owned components through
 * after the commit, and starts the start-up load that puts back what the last
 * run stored:
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
  // A start-up read that finishes late must not overwrite edits made while
  // storage was still opening.
  let loading = new Set<Eid>()
  let hydrated = false

  let write = (bundles: Bundle[]) => {
    let touched = [...new Set(bundles.map((b) => b.entity.eid))]
    return then(detached(graph.storage).get(touched), async (now) => {
      let save: Saved[] = []
      let gone: Eid[] = []
      let seen = new Set(now.map((b) => b.entity.eid))
      for (let b of now) {
        let held = dead(b) ? {} : localComps(b, vocab)
        if (Object.keys(held).length) {
          save.push({
            eid: b.entity.eid,
            num: b.entity.num,
            comps: held,
          })
        } else gone.push(b.entity.eid)
      }
      // An entity the store no longer holds at all is dropped from here too.
      for (let eid of touched) if (!seen.has(eid)) gone.push(eid)
      if (save.length) await vault.save(save)
      if (gone.length) await vault.drop(gone)
    })
  }

  let plugin: Plugin = {
    name: '@yaks/client/vault',
    // The two marks the load below puts on its bundles: this package's own, and
    // @yaks/sync's echo, which this graph may carry no sync plugin to declare.
    requests: [KEPT, ECHO],
    hooks: {
      effect: (bundles) => {
        if (!hydrated) {
          for (let b of bundles) {
            if (
              dead(b) ||
              comps(b).some(([name]) => vaulted(vocab, name))
            ) loading.add(b.entity.eid)
          }
        }
        return concerns(bundles, vocab)
          ? then(write(bundles), () => bundles)
          : bundles
      },
    },
  }
  graph.use(plugin)

  // Loading is applied the way a server's frame is (@yaks/sync `replicate`):
  // trusted, since these values were admitted once already; marked as an echo so
  // @yaks/sync does not post browser-owned components to a server; and as a
  // replica, so a word this copy is no longer loaded with is left out. It is
  // also marked as this package's own, so the hook above does not write back
  // what it just read.
  let ready = vault.load().then((recs) => {
    hydrated = true
    let bundles = recs.filter((r) => !loading.has(r.eid)).map((r): Bundle => ({
      entity: { eid: r.eid, num: r.num },
      ...r.comps,
      [KEPT]: true,
    }))
    loading.clear()
    if (!bundles.length) return
    return then(replicate(graph, bundles), () => undefined)
  })

  return { plugin, ready }
}
