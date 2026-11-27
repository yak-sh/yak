// What a host lends an app store's own graph facets: the work a committed
// write owes where the store runs. yaks.app's Store lends its own (workers/yak
// graph.ts `Stored`); another host lends what it has.
import type { Loaded } from '@yaks/blob'
import type { Handler } from '@yaks/effects'
import type { Bound, Bundle, Graph, Plugin } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'

export type Lent = {
  /** the store's name: an app's address, or the platform's own store */
  name: string
  now?: () => number
  /** what an app holds, told to whoever meters it once a write has committed */
  weigh: (bundles: Bundle[]) => Bundle[]
  /** the sleeping wakes a committed write makes hold, roused */
  rouse: (bundles: Bundle[]) => Promise<Bundle[]>
  /** the texts a committed write changed, embedded */
  embed: (bundles: Bundle[]) => Bundle[]
  /** the words a committed write brought, told to the Lexicon, in a store
   * that keeps one */
  tell?: (bundles: Bundle[]) => Bundle[]
  /** the write log's hook, which keeps a keyed write's answer as it commits */
  log: Plugin
  /** the app's manifest, its `vocab.json`, as deployed now */
  manifest: () => VocabDoc
  /** the platform's own job a rule's row asks for by name (a sweep its wake
   * row's kind names, a held number's month), lent only by the store that
   * keeps the platform's schedules */
  job?: (name: string, row: Bound) => Promise<undefined>
  /** a file of the app's release by its path from the release's root
   * (`/index.html`), or null where it has none, lent by a host that serves
   * the release's files beside its store (./files-routes.ts); yaks.app
   * serves them from R2 at its gateway instead */
  file?: (path: string) => Promise<Loaded | null>
  /** the graph this package's own effects write the store's bookkeeping
   * through, the host's own where it lends none */
  graph?: Graph
}

/** The options each of these facets is bound with. */
export type Options = { store: Lent }

/** What a host lends a store it keeps no ledger beside: the store's name and
 * its app's manifest, and nothing owed once a write commits. No meter weighs
 * it, no alarm rouses its wakes, nothing embeds its texts, and the write log
 * is the host's own (@yaks/api's graph facet keeps a keyed write's answer). */
/// bare('recipes', {}).name -> 'recipes'
/// bare('recipes', { $defs: {} }).manifest() -> { $defs: {} }
/// bare('recipes', {}).weigh([]) -> []
export let bare = (name: string, manifest: VocabDoc): Lent => ({
  name,
  weigh: (bundles) => bundles,
  rouse: (bundles) => Promise.resolve(bundles),
  embed: (bundles) => bundles,
  log: { name: 'yak/log', hooks: {} },
  manifest: () => manifest,
})

/** What each plugin is bound with beside its configured options: a store's
 * own plugins (`yak/*`) are given the store. */
/// lends(bare('a', {}))('yak/log', {}).store.name -> 'a'
/// lends(bare('a', {}))('@yaks/doc', { x: 1 }) -> { x: 1 }
export let lends = (store: Lent): Lend => (plugin, options) =>
  plugin.startsWith('yak/') ? { ...options, store } : options

/** A host's plugin options, with what it lends beside them (@yaks/host
 * `Binding.options`). */
export type Lend = <O extends Record<string, unknown>>(
  plugin: string,
  options: O,
) => O

/** A handler that is the store's own upkeep, not anyone's use of it: a host
 * that measures use does not count its run (yaks.app's dormancy). */
export let maintenance = (run: Handler): Handler & { maintenance: true } =>
  Object.assign(run, { maintenance: true as const })
